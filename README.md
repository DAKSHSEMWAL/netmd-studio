# NetMD Studio

A local app for recording audio to NetMD MiniDisc players. Includes a music library, editable recording queue, disc comparison, local encoding cache, recovery checkpoints, and Walkman playback controls.

Experimental software, developed with a Sony MZ-N920 on Windows. Physical recording is hardware-dependent. An acknowledgment or a zero-track response does not prove the recorder finished writing its TOC. Keep stable power connected and wait for **TOC Edit / Data Save** to disappear before unplugging or opening the lid.

## Setup

1. Install Node.js 20 or newer and Git.
2. Install FFmpeg and FFprobe and put them on PATH, or configure their full paths below.
3. For LP2, download the Windows encoder from the official [atracdenc releases](https://github.com/dcherednik/atracdenc/releases) and configure its executable path. SP uses the recorder's hardware encoder and does not require atracdenc.
4. Use the USB driver appropriate for [netmd-js](https://github.com/cybercase/netmd-js) on your system. On Windows this app uses WinUSB. Close Web MiniDisc and other NetMD clients before connecting.
5. Run `npm install` in this repository.
6. Copy `config.example.json` to `config.json` and change the paths for your machine. The default music library is your user Music directory. You can also set `MUSIC_ROOT`, `FFMPEG_PATH`, `FFPROBE_PATH`, and `ATRACDENC_PATH` as environment variables.
7. Run `npm start`, then open **http://127.0.0.1:17892**. Windows users can use **Start NetMD Studio.cmd** instead.

No music files, encoder binaries, device drivers, private configuration, logs, caches, or recording-session data are included in this repository. Install dependencies separately. Git may be needed during npm installation because an upstream dependency is hosted on GitHub.

## Recording

Connect/reload the disc, select files from the library, and add them to the queue. Supported inputs include FLAC, WAV, MP3, M4A, OGG and AAC. Edit titles and reorder songs before recording. Choose LP2 or SP; remaining capacity is calculated in that mode. Recording appends tracks and checks capacity, title space, duplicates and write protection before transferring.

**Compare with disc** checks normalized artist/title text and duration. **Keep only missing** removes confirmed matches and repeated queue entries; duration conflicts require review. This is metadata matching, not audio fingerprinting, so differently titled copies may not match. Queue changes synchronize between app windows.

**Prepare / cache queue** encodes on this computer without accessing the Walkman. SHA-256 cache keys include the source file, recording mode, conversion settings and tool binaries. Cached payload checksums are checked before reuse. The cache survives restarts and saves encoding time; USB transfer time is unchanged. LP2 uses the open-source atracdenc encoder, whose output quality may differ from Sony's encoder.

New folders containing supported audio are detected about every five seconds. Empty folders are not shown. Folder/search selection and the queue are kept.

## Interrupted sessions

Recording saves the original queue, disc baseline and per-song checkpoints locally. After restoring reliable power and letting the Walkman settle, use **Check saved session**, then **Resume remaining songs**. Resume rereads the disc, skips matching tracks actually present and accounts for TOC rollback. An absent interrupted song restarts from the beginning; byte-level continuation is not supported.

Partial/mismatched tracks block resume and are not erased automatically. If a track is present without a saved completion acknowledgment, listen through its end before confirming resume. Disc matching uses title, capacity and existing track metadata, so identical blank discs cannot be uniquely distinguished. Resume is not a disc repair tool.

## Playback and erase

Play, Pause, Stop, Previous/Next and track selection control the physical Walkman. Sound comes from its headphone output. **Listen on PC** plays the local source file, not a USB stream from the MiniDisc.

**Disconnect** releases app access and keeps the queue. It is blocked during an active operation. It does not finish a hardware TOC save or physically disconnect USB.

**Erase disc** deletes every track after you type `ERASE`. It rechecks the disc against the confirmed contents before sending the command. Never interpret an app acknowledgment as proof the physical TOC save completed. No erase retry is automatic.

## Validation

Run `npm test` after setup. Tests cover queue synchronization, metadata matching, cache integrity and invalidation, recovery reconciliation, erase confirmation, local API authentication, audio range serving, and path restrictions. Tests do not write to a USB device. Physical power-loss recovery and erase behavior cannot be guaranteed by these tests.

## Dependencies and licenses

Application code: MIT. Third-party projects retain their own licenses: [netmd-js](https://github.com/cybercase/netmd-js), [node-usb](https://github.com/node-usb/node-usb), [FFmpeg](https://ffmpeg.org/legal.html), and [atracdenc](https://github.com/dcherednik/atracdenc). Their binaries and source are not bundled here.
