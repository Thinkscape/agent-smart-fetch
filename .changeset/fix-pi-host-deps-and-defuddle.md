---
"pi-smart-fetch": patch
---

Declare host-provided packages (@earendil-works/pi-tui, @sinclair/typebox) as peerDependencies with a "*" range and externalize @earendil-works/pi-tui in the build so it is no longer bundled into dist (avoids duplicate runtime modules). Bump defuddle to ^0.19.4 (resolves the @xmldom/xmldom high-severity audit via mathml-to-latex@1.8.0 -> @xmldom/xmldom@0.9.12).
