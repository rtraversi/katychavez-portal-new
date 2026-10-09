# Lab mockup (design reference only)

The clickable mockup Max approved, round by round, before the real build. It is kept here
so the design intent travels with the code. It is **not** part of the app and is not
served by the portal.

- It needs Max's separate lab server to run, so it will not open from here.
- The runnable version of this design is the real page:
  `npm run preview:proof-scan-v2`, then http://127.0.0.1:8788/
- All data in `fixtures/` is synthetic. The SSN `000-12-4821` uses the 000 area, which is
  never issued.
- Where the mockup and the real build differ, the real build and
  `../DECISIONS-MASTER-RECORD.md` win. Known differences: the build numbers the new rules
  PS-305 (shared facts across forms) and PS-306 (translations), and keeps the browser free
  of any result logic (the mockup computes results in the browser to fake the server).
