# Rules for every 400-line split task

Julio chose on 2026-10-10 to run all 131 tasks of `docs/audit/size-plan.md`. Every split task follows these rules. Its spec gives only the file, the plan entry and anything special.

1. **One source file per task.** Split the file the spec names into the new files that its `size-plan.md` §2 entry lists. Line ranges in the plan come from main at `a64ac2b6`. Re-read the file, because ranges can drift a little.
2. **No behaviour change.** Move code unchanged. Rename only where two moved pieces would clash. Apply the entry's **Dedup** items only when they stay inside this file and its new files; dedup that crosses files is a separate F task.
3. **Importers do not change.** The original path stays a thin barrel that re-exports every name it exported before, with the same names and kinds (value or type). No file outside the task's own files is edited. If a cycle forces one importer to change, stop and report it.
4. **Size.** Every new file and the barrel stay at most 400 lines. If one module of the plan would end up over 400, split it once more along a boundary the entry names, and say so in the Report.
5. **Tests.** Write no new tests and edit no test, except an import path if one breaks, which the barrel should prevent. The nearest kept tests must still pass.
6. **Effect ratchet.** A new file that holds code moved unchanged from a file the base already counts may trip the ratchet ("needs Effect"). Then add `// effect-plain: moved unchanged from <old path> (size split)` in its first lines, and list it in the Report. Never add the marker for any other reason.
7. **Lint and format.** `pnpm gate` must pass. A `max-lines` warning in the split files is the bug being fixed and must not appear.
8. **The Report gives:**
   - the `wc -l` of the old file and of every new file;
   - the export list before and after, as a diff (`grep -E "^export"` on the old file against the barrel plus the new files);
   - the gate summary.
