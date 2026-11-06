"""Opt-in localhost transport for read-only OP-Z SysEx on Steam Deck."""
import ctypes
import errno
import json
import threading
from http.server import SimpleHTTPRequestHandler


class DeckMidi:
    def __init__(self, device):
        self.device = device
        self.alsa = ctypes.CDLL("libasound.so.2")
        self.alsa.snd_rawmidi_read.restype = ctypes.c_ssize_t
        self.alsa.snd_rawmidi_write.restype = ctypes.c_ssize_t
        self.input = ctypes.c_void_p()
        self.output = ctypes.c_void_p()
        self.packet = bytearray()
        self.status = 0
        self.short = bytearray()
        self.lock = threading.Lock()
        self.client = None
        self.ui_state = None
        self.square_held = False
        self.square_events = set()

    def close(self):
        for handle in (self.input, self.output):
            if handle:
                self.alsa.snd_rawmidi_close(handle)
                handle.value = None
        self.packet.clear()
        self.status = 0
        self.short.clear()

    def exchange(self, frames, client, start):
        messages = [bytes.fromhex(frame) for frame in frames]
        if not all(self.allowed(message) for message in messages):
            raise ValueError("Only OP-Z read queries and acknowledgements are allowed")
        with self.lock:
            if start:
                self.close()
                self.client = client
                self.ui_state = None
                self.square_held = False
                self.square_events.clear()
            if self.client != client:
                raise PermissionError("Another OP-B window owns the MIDI connection")
            try:
                return self.transfer(messages)
            except OSError:
                self.close()
                raise

    @staticmethod
    def allowed(message):
        if message == bytes.fromhex("f07e7f0601f7"):
            return True
        if not message.startswith(bytes.fromhex("f000207601")) or not message.endswith(b"\xf7"):
            return False
        if len(message) < 7 or any(b >= 128 for b in message[6:-1]):
            return False
        mid, body = message[5], message[6:-1]
        return ((mid == 0 and len(body) == 4 and body[-1] == 6)
                or (mid in (8, 15) and not body)
                or (mid == 11 and len(body) == 10 and body[1:5] == b"\x09\0\0\0"))

    def transfer(self, messages):
        if not self.input:
            rc = self.alsa.snd_rawmidi_open(ctypes.byref(self.input), ctypes.byref(self.output),
                                          self.device.encode(), 2)
            if rc < 0:
                raise OSError(-rc, "Cannot open OP-Z RawMIDI")
        for message in messages:
            if self.alsa.snd_rawmidi_write(self.output, message, ctypes.c_size_t(len(message))) != len(message):
                raise OSError("RawMIDI send failed")
        buffer = ctypes.create_string_buffer(4096)
        count = self.alsa.snd_rawmidi_read(self.input, buffer, ctypes.c_size_t(len(buffer)))
        if count < 0 and count != -errno.EAGAIN:
            raise OSError(-count, "RawMIDI read failed")
        frames = []
        for byte in buffer.raw[:max(0, count)]:
            if byte >= 0xf8:
                if byte in (0xf8, 0xfa, 0xfb, 0xfc):
                    frames.append(f"{byte:02x}")
            elif byte == 0xf0:
                self.status = 0
                self.short.clear()
                self.packet = bytearray([byte])
            elif byte == 0xf7 and self.packet:
                self.packet.append(byte)
                frames.append(self.packet.hex())
                self.packet.clear()
            elif byte < 128 and self.packet:
                self.packet.append(byte)
                if len(self.packet) > 65536:
                    self.packet.clear()
            elif byte >= 0x80:
                self.packet.clear()
                self.short.clear()
                self.status = byte if byte < 0xf0 else 0
            elif self.status:
                self.short.append(byte)
                length = 1 if self.status & 0xe0 == 0xc0 else 2
                if len(self.short) == length:
                    frames.append((bytes([self.status]) + self.short).hex())
                    self.short.clear()
        return frames


def bridge_handler(midi):
    class Handler(SimpleHTTPRequestHandler):
        def do_POST(self):
            if self.path != "/deck-midi":
                self.send_error(404)
                return
            host = f"127.0.0.1:{self.server.server_port}"
            if (self.headers.get("Host") != host or self.headers.get("Origin") != f"http://{host}"
                    or self.headers.get_content_type() != "application/json"):
                self.send_error(403)
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 4096:
                    raise ValueError("Invalid request size")
                self.connection.settimeout(2)
                frames = json.loads(self.rfile.read(length))
                if not isinstance(frames, list) or not all(isinstance(frame, str) for frame in frames):
                    raise ValueError("Expected a list of MIDI frames")
                client = self.headers.get("X-OPB-Client", "")
                if not client or len(client) > 64:
                    raise ValueError("Invalid MIDI client")
                received = midi.exchange(frames, client, self.headers.get("X-OPB-Start") == "1")
                for frame in received:
                    if frame.startswith("f000207601") and frame[10:12] in ("0a", "10"):
                        self.log_message("OP-Z SysEx $%s delivered to bridge client", frame[10:12].upper())
                    elif frame.startswith("f00020760106") and frame != midi.ui_state:
                        midi.ui_state = frame
                        body = bytes.fromhex(frame[12:-2])
                        if len(body) >= 5:
                            held = bool(body[3] & 0x20)
                            if held and not midi.square_held:
                                midi.square_events.clear()
                            midi.square_held = held
                        self.log_message("OP-Z UI state $06 packed=%s", body.hex())
                    elif midi.square_held:
                        event = None
                        if frame.startswith("f000207601"):
                            event = f"SysEx ${frame[10:12]}"
                        elif len(frame) == 6 and frame.startswith("b"):
                            event = f"CC channel {int(frame[1], 16) + 1} controller {int(frame[2:4], 16)}"
                        if event and event not in midi.square_events:
                            midi.square_events.add(event)
                            self.log_message("OP-Z square held: %s", event)
                result = json.dumps(received).encode()
            except PermissionError as exc:
                self.send_error(409, str(exc))
                return
            except (ValueError, OSError) as exc:
                self.send_error(503 if isinstance(exc, OSError) else 400, str(exc))
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(result)))
            self.end_headers()
            self.wfile.write(result)

        def log_request(self, code="-", size="-"):
            if self.path != "/deck-midi" or str(code) != "200":
                super().log_request(code, size)

    return Handler
