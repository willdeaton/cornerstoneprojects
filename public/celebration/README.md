# Quote-won celebration images

`WonCelebration` (src/components/WonCelebration.tsx) picks one of these at
random and throws it up full-screen whenever a quote is marked sold.

Expected files — any of them missing just means that pick falls back to a plain
"SOLD!" card, so a gap here never breaks the flow:

| File        | Image                            |
| ----------- | -------------------------------- |
| `won-1.png` | "That's what I'm talking about!" |
| `won-2.png` | "Yay! We got work!"              |
| `won-3.png` | "Somebody load the truck!"       |

Keep them PNG with a white or transparent background — they're laid on a white
card — and no wider than about 1400px, since they display at 62vh tall at most.
To add or swap one, drop the file in here and update the `IMAGES` list in the
component.
