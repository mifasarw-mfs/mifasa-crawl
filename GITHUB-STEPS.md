# MIFASARW on GitHub: step by step (Android APK)

The website stays on **Neocities**. GitHub is used to **build the Android app (APK)** with `android.yml`.
The app opens https://mifasarw.neocities.org, so every site update reaches the app at once.

## Part 1: Put the offline update on the site (Neocities)
1. Upload these 4 files to Neocities (replace the old ones): `mifasa-offline.js` (new), `sw.js`, `offline.html`, `story.html`.
2. Open the site once on your phone, then open a story: you will see **💾 Bika offline**. Tap it.
3. Turn on airplane mode, open `/offline.html`: the story opens, and **📂 Hitamo dosiye** opens your own files.

## Part 2: Create the GitHub repository
1. github.com -> **New repository** -> name `mifasarw` -> Public -> Create.
2. **Add file -> Upload files**: upload `icon-512.png` (the app icon) to the main folder. Commit.
3. **Add file -> Create new file**. In the name box type exactly: `.github/workflows/android.yml`
   (typing the `/` makes the folders). Paste the whole content of `android.yml`. Commit.
   IMPORTANT: if `android.yml` is in the main folder, GitHub will NOT run it. It must be inside `.github/workflows/`.

## Part 3: Build the APK (test version)
1. Repo -> **Actions** tab. If asked, click **"I understand my workflows, enable them"**.
2. Left side: **mifasa-android** -> **Run workflow** (leave "release" unticked) -> green **Run workflow**.
3. Wait 8-15 minutes until the circle is green.
4. Download: repo -> **Releases** -> **MIFASARW Android (latest)** -> `MIFASARW.apk`. Send that link to people (or put it in `install.html`).
5. On the phone: open the APK -> allow "install unknown apps" -> Install.

## Part 4: Signed release (for Google Play, later)
1. On a computer with Java: `keytool -genkeypair -v -keystore mifasa.jks -alias mifasa -keyalg RSA -keysize 2048 -validity 10000`
2. `base64 -w0 mifasa.jks` -> copy the output.
3. Repo -> **Settings -> Secrets and variables -> Actions -> New repository secret**. Create 4 secrets:
   `KEYSTORE_BASE64` (the output), `KEYSTORE_PASSWORD`, `KEY_ALIAS` (= `mifasa`), `KEY_PASSWORD`.
4. **Keep `mifasa.jks` safe forever.** Every future update must use the same file.
5. Actions -> mifasa-android -> Run workflow -> **tick "release"** -> you get `MIFASARW.apk` and `MIFASARW.aab` (upload the .aab to Google Play).

## Every day after that
- Change the site on Neocities -> app updates by itself. No new APK needed.
- New APK is needed only to change the icon, app name, or native features.
- To force every phone to refresh its offline cache, change `VERSION = "v8"` to `"v9"` in `sw.js`.

## About videos
- YouTube videos **cannot be downloaded or played offline** from the site (YouTube rules, and the player needs internet).
  Offline saves the story text, images, and the video title + thumbnail + link.
- Your OWN video files (from your phone or YouTube Studio) can be opened offline with **📂 Hitamo dosiye**.
