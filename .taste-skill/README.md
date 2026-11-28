# Taste skill: deal history and home page checks

The JSON files here are the taste skill's deal history (committed, so pages keep varying). `shots/` and `.taste-profile/` are gitignored.

The skill is installed at user level: `%USERPROFILE%\.claude\skills\taste-skill` (v2.5; needs Node 22+ and Chrome/Edge). Run its scripts from the skill folder, against the running dev server. `CHROME_PATH` must point to Edge (`C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`): Chrome is installed per-user and the scripts don't find it.

Home page checks:

```powershell
node <skill>/assets/layout/check.mjs --url http://localhost:3000/ --profile <dir> --sizes 1440x900,1024x768,820x1180,768x1024,390x844
node <skill>/scripts/consistency.mjs http://localhost:3000/ --widths 1440,1024,820,768,390 --rhythm-widths 1440,820,768,390 --page software --category "hospital appointment booking" --primary "Book an appointment" --profile <dir>
```

- The layout check passes at all five sizes.
- The consistency check takes about 10 minutes. Expected findings, judged false: `container-edges` on the centred hero (the dealt `centred` hero is the layout guide's one centred exception), and the scroll/flush/contrast findings inside `#requests` (the dealt `iris-opens` moment; moments.md says that one is expected).
- If you start a temporary dev server for the checks, stop it when done: a leftover one holds port 3000.
