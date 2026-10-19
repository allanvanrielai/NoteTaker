# NoteTaker: working rules

## Git workflow
- Before starting a change, check that the working tree is clean (`git status`). If it isn't, report it and ask Allan before doing anything.
- After every completed and tested change, make one commit with a message summarising what changed and why.
- Push after each commit.
- Use git for backups. Do not keep backup copies in temp folders.

## Project
- NoteTaker runs on port 47613.
- Do not modify Image Keeper while working on NoteTaker.

## Testing and data
- Test in throwaway Chrome profiles. Do not write to Allan's real folders.
- Never commit note content or backups (`DATA/` and any note, backup or export files are git-ignored).
