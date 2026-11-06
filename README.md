# WEB-Z 0.1.2 Beta

WEB-Z is an unofficial web port of [OP-B (OP-Z-Windows)](https://github.com/seb-glbd/OP-Z-Windows) by seb-glbd. Unofficial; not affiliated with Teenage Engineering.

**[Launch the GitHub Pages beta](https://balancechiang.github.io/WEB-Z/)** · [Credits](https://balancechiang.github.io/WEB-Z/credits.html)

The test site starts with a synthetic demo. In a compatible Chromium browser, **CONNECT OP-Z** attempts direct USB Web MIDI. The Steam Deck ALSA bridge runs locally.

## Build and run locally

Use Node.js 24 and Python 3.

```sh
npm ci
npm run typecheck
npm run build
python3 serve_localhost.py
```

On Steam Deck, identify the OP-Z RawMIDI port with `amidi -l`. Substitute the detected port for `hw:2,0,0`:

```sh
python3 serve_localhost.py --port 8766 --deck-midi hw:2,0,0
```

Open the URL printed by the launcher and click **CONNECT OP-Z**. The local bridge supports read-only device synchronization. Use **HIDE DEBUG** and **SHOW DEBUG** to toggle the tools in the current window. **FULL SCREEN** separately toggles browser fullscreen.

GitHub Pages serves the checked-in browser build from `main`. When updating the site, rebuild and include `dist/app.js` in the commit.

## Credits and licensing

- [OP-B / OP-Z-Windows](https://github.com/seb-glbd/OP-Z-Windows) by seb-glbd for the original application, interface and state synchronization.
- [op-z-sysex](https://github.com/kmorrill/op-z-sysex) by Kevin Morrill for protocol research and hardware validation. Its MIT notice is in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- [libopz](https://github.com/leddy231/libopz) and its [upstream project](https://github.com/patriciogonzalezvivo/libopz) for protocol references.

The OP-B author encouraged a web adaptation in the [original Reddit discussion](https://www.reddit.com/r/OPZuser/comments/1xefkwd/made_a_windows_version_of_the_app/). The upstream repository does not state a project-wide license, and this repository makes no blanket license grant for upstream material. The notices linked above identify the components covered by their stated terms.
