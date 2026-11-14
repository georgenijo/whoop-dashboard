# App typefaces

DM Sans carries the Fleet Warehouse visual language into Coach. The four bundled static instances were generated from Google Fonts' `ofl/dmsans/DMSans[opsz,wght].ttf` at optical size 14 and weights 400, 500, 600, and 700. FontTools instancing removes the variation axes; family/style/PostScript names are normalized to `DM Sans` / the weight / `DMSans-<weight>` for reliable UIKit registration. The source uses the SIL Open Font License; see `OFL-DMSans.txt`.

Source: https://github.com/google/fonts/tree/main/ofl/dmsans (source TTF Git blob `c672f98060af9b2c85fca704ebd5ad9a8717c1df`).

Register new font resources in both `Info.plist` and `project.yml`; XcodeGen merges them into the app's generated plist. `DailyBriefTests.testWarehouseTypefaceIsRegisteredInTheAppBundle` checks the actual registered UIKit families, so a silent fallback is a test failure.

DM Sans uses tabular figures for measured values. Geist Mono remains available for code blocks. Font sizes still scale through the shared Dynamic Type styles; the Warehouse's desktop font sizes are not used for phone body text.
