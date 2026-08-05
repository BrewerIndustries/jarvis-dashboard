# 📱 Shipping a new Jarvis **iOS** app — recipe card

The iOS counterpart to [`NEW-PROJECT.md`](./NEW-PROJECT.md). How to take a native
iPhone app from empty folder to the **App Store**, hooked into the **dashboard**
(the single front door) under its new **iOS Apps** section.

The web recipe assumes "dev site + prod site on their own URLs." An iOS app is
different: the artifact is a **signed binary**, and "prod" is the **App Store**,
reached through **TestFlight**. But the *spine* is the same — one GitHub repo,
`dev` + `main`, promote to `main` only via a PR you approve.

> First app? The gating step is Apple Developer Program enrollment (individual,
> $99/yr, identity verification can take 24–48h). Start it before anything else:
> <https://developer.apple.com/programs/>. You also need **full Xcode** installed
> (Mac App Store, ~15 GB) — Command Line Tools alone can't build an app or widget.

## The model (read once)

- One GitHub repo per app (account **`BrewerIndustries`**) with **`dev`** + **`main`**.
- **`dev` = day-to-day work, TestFlight builds.  `main` = App Store releases.**
  Promote to `main` only via a PR you approve — never fast-forward / reset-push.
- **No localhost port, no `<app>.dabrewer.dev` app URL.** The app ships to the
  App Store. The only web surface is a small **privacy + support site** (Apple
  requires both URLs) — that part *does* use the GitHub Pages flavor from the web
  recipe, at `<app>.dabrewer.dev`.
- Bundle IDs follow reverse-DNS of the dev domain: `dev.dabrewer.<app>` (app),
  `dev.dabrewer.<app>.widget` (widget), App Group `group.dev.dabrewer.<app>`.

## Project layout — **XcodeGen** (so the project is text, not a binary blob)

We generate `*.xcodeproj` from a checked-in `project.yml` with
[XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`), so the
project is reviewable in git and reproducible in CI without opening Xcode.

```
<app>/
  project.yml                     # source of truth — targets, App Group, signing
  <App>/                          # app target (SwiftUI): App/ Views/ Store/ ImportKit/ Resources/
  <App>Widget/                    # WidgetKit extension (Bundle + Widget + timeline)
  Shared/                         # code compiled into BOTH targets: Models/ Storage/ Study/ WidgetShared/
  Config/<App>.storekit           # local StoreKit config for simulator IAP testing
  <App>.entitlements              # App Group (app)
  <App>Widget/<App>Widget.entitlements  # App Group (widget)
  .github/workflows/ios-ci.yml    # build on every dev push / PR into main
  .jarvis.json                    # dashboard hookup (category "ios")
```

Regenerate after any structural change (new files/targets):

```bash
cd <app> && xcodegen generate
```

The generated `.xcodeproj` **is committed** so the app opens with a double-click;
`project.yml` stays authoritative. (Prefer generate-on-checkout? Add `*.xcodeproj/`
to `.gitignore` instead.)

### The one thing first-timers miss: the **App Group**

The home-screen widget can't read the app's database directly. Both the app and
the widget must join the same **App Group** (`group.dev.dabrewer.<app>`), and the
SwiftData/Core Data store must live in that shared container. It's declared in:
1. `<App>.entitlements` and `<App>Widget.entitlements` (both list the group), and
2. the Apple Developer portal → Identifiers → **App Groups** (created under your team).

Without it the widget silently shows placeholder data.

## 1. Declare it — `.jarvis.json` (the dashboard hookup)

Drop a `.jarvis.json` at the repo root with **`"category": "ios"`** — that's what
routes the card into the dashboard's **iOS Apps** section (rendered above the web
lanes; cards show a release-stage pill — App Store / In Dev / Shelved — instead of
a live/down health badge, and link to GitHub / the store listing).

```json
{
  "id": "flashcards",
  "name": "Flashcards",
  "category": "ios",
  "platform": "ios",
  "description": "One-liner shown on the card.",
  "tech": ["Swift", "SwiftUI", "SwiftData", "WidgetKit", "StoreKit 2"],
  "status": { "prod": "in_progress", "dev": "in_progress" }
}
```

- `status` lanes map to release stages: `in_progress` → **In Dev**, `live` → **App
  Store** (set this once it's approved & live), `mothballed` → **Shelved**.
- **No `deploy` block** while unreleased (nothing to health-ping). Once it's on the
  App Store, add `"deploy": { "prod": { "url": "https://apps.apple.com/app/idXXXXX" } }`
  so the card gets a **Launch ↗** button to the listing (and TestFlight for `dev`).
- The same cron as the web apps (`sync-registry.sh`, every 15 min) reads it via the
  GitHub API — **dev branch → dev registry, main → prod registry**. No dashboard
  edit needed; the card auto-appears in the iOS section.

## 2. Link GitHub inside Xcode (do this once, makes everything easier)

So you can clone/commit/push/branch/PR without leaving Xcode:

1. **Xcode ▸ Settings ▸ Accounts ▸ +  ▸ GitHub.** Sign in with account
   `BrewerIndustries` using a **Personal Access Token** (GitHub ▸ Settings ▸
   Developer settings ▸ Tokens) with `repo` + `workflow` scopes — not your password.
2. **Create the repo** (from the box or your Mac):
   ```bash
   gh repo create BrewerIndustries/<app> --private --source . --remote origin --push
   git push -u origin dev            # dev is the working branch — push freely
   ```
3. In Xcode the repo now shows under **Source Control navigator** (⌘2). Use the
   **Source Control** menu to commit, push, pull, branch, and **create a PR**
   (`dev` → `main`) when you're ready to promote.
4. Xcode's git ignores are handled by the committed `.gitignore` (Xcode/Swift/
   fastlane/secrets). **Never commit** `*.p8` / `*.p12` / `*.mobileprovision`.

## 3. Signing (after enrollment)

- Open `<App>.xcodeproj` ▸ target ▸ **Signing & Capabilities** ▸ check **Automatically
  manage signing** ▸ pick your Team. Do the same for the widget target.
- Set the same **Team ID** in `project.yml` (`DEVELOPMENT_TEAM`) so regenerating
  keeps it. Confirm the **App Group** capability is present on both targets.
- IAP testing without App Store Connect: **Scheme ▸ Run ▸ Options ▸ StoreKit
  Configuration ▸ `Config/<App>.storekit`.**

## 4. CI — the dev→prod gate for the binary

`.github/workflows/ios-ci.yml` runs on **every push to `dev`** and **every PR into
`main`**: it installs XcodeGen, generates the project, and builds the app + widget
against the simulator SDK **unsigned** (`CODE_SIGNING_ALLOWED=NO`) on a `macos-14`
runner. Green CI = it compiles; that's the bar to promote. (Signed TestFlight
uploads are done from Xcode / fastlane, not CI, until signing secrets are added.)

## 5. Promote & release (the CI/CD path)

- Work on **`dev`** → build to your device / TestFlight → verify.
- Promote to **`main`** only via a **PR you approve** (`gh pr create --base main
  --head dev`), same rule as every Jarvis repo. Merge → tag `v1.0.0`.
- **Release the binary:** Xcode ▸ **Product ▸ Archive** ▸ Distribute App ▸ App Store
  Connect ▸ Upload → the build appears in **TestFlight** → submit for **App Store**
  review from App Store Connect. First review often bounces once (privacy label,
  missing "Restore Purchases", IAP metadata) — normal.
- After it's live: set the app's `.jarvis.json` `status.prod` to `live` and add the
  App Store `deploy.prod.url`.

## 6. Privacy + support site (GitHub Pages flavor)

Apple requires a **privacy policy URL** and a **support URL**. Publish a tiny static
site from the same repo (or a `-site` repo) using the **GitHub Pages** flavor in
[`NEW-PROJECT.md`](./NEW-PROJECT.md#2-pick-a-hosting-flavor):
`<app>.dabrewer.dev/privacy` and `<app>.dabrewer.dev/support`. Source content lives
in the repo at `docs/privacy-policy.md`. For a local-only, no-accounts app the App
Privacy answer is **"Data Not Collected."**

## Checklist for a new iOS app

- [ ] Apple Developer Program enrolled · full Xcode installed
- [ ] Repo created (`--private`), `dev` + `main`, `.gitignore`, GitHub linked in Xcode
- [ ] `project.yml` (app + widget targets, App Group), `xcodegen generate` succeeds
- [ ] App Group registered in the developer portal + on both targets
- [ ] `.jarvis.json` with `"category": "ios"` committed → card appears in iOS section
- [ ] `ios-ci.yml` green on `dev`
- [ ] StoreKit config attached to Run scheme; IAP tested in simulator
- [ ] App icon + screenshots; privacy policy + support page live on Pages
- [ ] Archive → TestFlight → submit for review
- [ ] Approved → `status.prod: live` + App Store `deploy.prod.url`

## Reference implementations

- **Flashcards** (`BrewerIndustries/flashcards`) — SM-2 spaced repetition, due-cards
  widget, CSV import, freemium unlock.
- **Vocabulary** (`BrewerIndustries/vocab`) — word-of-the-day widget, rich word
  entries, curated packs. Built on the same shared pattern as Flashcards.
