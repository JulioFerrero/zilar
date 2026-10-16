export const HELP = `lead — zero-token supervision of OpenCode workers

Usage: lead <command> [options]

  launch <T-XXXX> [--extra-rules <file>] [--base <ref>]      create the worktree and worker session (--base branches off an older commit)
  switch-model <T-XXXX> <provider/model> [--extra-rules <file>] [--in-place]
                                                            move a tracked worker onto a new model (quota fallback)
                                                            --in-place keeps the same session and its context; send lead reply after it if the worker is idle
  autopilot [--once] [--dry-run]                            watch sessions, answer permissions, nudge, pre-review
  doctor [--since <sha>]                                    audit main now with a Muse doctor session
  prereview <T-XXXX>                                        start a Muse pre-review manually
  reply <T-XXXX> <prompt-file> [--fresh]                   interrupt the worker and re-prompt it
  merge <T-XXXX> --summary "<one line>" [--skip-gate] [--hold]
                                                            rebase, run the gate, squash onto main, board, push, clean up
                                                            (--hold merges without pushing; run \`lead push\` to deploy)
                                                            ("T-XXXX: summary" is the commit subject, at most 72 characters)
  push                                                      push main to origin (deploys; use after \`lead merge --hold\`)
  batch check <T-A> <T-B> ...                               combine the branches on a wave worktree, run install, typecheck and every
                                                            package's tests, write one fix file per task under ~/.zilar-lead/wave/
  batch merge <T-A> <T-B> ...                               merge a checked wave task by task, no gate (refuses when the check is stale)
  spec-check <T-XXXX>                                    check a spec's paths, routes and web claims against the code
  snapshot                                                  JSON of every task in flight, its step and timings
  dashboard <out.html>                                      the snapshot rendered as the dashboard page
  status                                                    compact table of every tracked task
  forget <T-XXXX> [...] | --finished [--dry-run]            drop tracked tasks from the state file
  watch [--no-icons]                                          live terminal view of every running task

State lives outside the repo at ~/.zilar-lead/state.json (or ZILAR_LEAD_STATE).
Escalations print as one LEAD: line each on stdout; everything else goes to lead.log.
The autopilot never merges, pushes, or edits task files or the board.
`;
