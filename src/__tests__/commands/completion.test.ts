import { describe, test, expect } from "bun:test";
import { renderBashCompletion, renderFishCompletion, renderZshCompletion } from "../../commands/completion";

describe("completion fish", () => {
  test("commands and branches are newline separated", () => {
    const script = renderFishCompletion(["FEAT-123", "master"], "/tmp/worktrees");

    const commandsLine = script.match(/function __ns_commands\n  ([^\n]+)/)?.[1] ?? "";
    const branchesLine = script.match(/function __ns_branches\n  ([^\n]+)/)?.[1] ?? "";

    expect(commandsLine).toContain("printf");
    expect(commandsLine).toContain("\\n");
    expect(branchesLine).toContain("printf");
    expect(branchesLine).toContain("\\n");
  });

  test("branch listing uses provided branches", () => {
    const script = renderFishCompletion(["master"], "/tmp/worktrees");
    expect(script).toContain('function __ns_branches');
    expect(script).toContain('printf "%s\\n" master');
    expect(script).not.toContain('command ls -1 "/tmp/worktrees"');
  });

  test("branch completion includes branch-taking commands", () => {
    const script = renderFishCompletion(["FEAT-123"], "/tmp/worktrees");
    expect(script).toContain("status");
    expect(script).toContain("rm");
    expect(script).toContain("doctor");
    expect(script).toContain("open");
    expect(script).toContain("close");
  });

  test("add completion includes manager subcommand and branches", () => {
    const script = renderFishCompletion(["FEAT-123"], "/tmp/worktrees");

    expect(script).toContain("function __ns_add_subs");
    expect(script).toContain("manager");
    expect(script).toContain('complete -c ns -n "__ns_needs_add_subcommand" -a "(__ns_add_subs)"');
    expect(script).toContain('complete -c ns -n "__ns_needs_add_branch" -a "(__ns_branches)"');
  });

  test("branch completion is positional for fish", () => {
    const script = renderFishCompletion(["FEAT-123"], "/tmp/worktrees");

    expect(script).toContain('complete -c ns -n "__ns_needs_top_level_branch" -a "(__ns_branches)"');
    expect(script).toContain('function __ns_needs_workspace_template_branch');
    expect(script).not.toContain('__fish_seen_subcommand_from start stop status');
  });

  test("snapshot completion includes snapshot name helper", () => {
    const script = renderFishCompletion(["FEAT-123"], "/tmp/worktrees", "/tmp/snapshots");
    expect(script).toContain("function __ns_snapshot_names");
    expect(script).toContain("function __ns_needs_snapshot_branch");
    expect(script).toContain("function __ns_needs_snapshot_name");
    expect(script).toContain("/tmp/snapshots/$branch");
    expect(script).toContain('printf "%s\\n" latest');
    expect(script).toContain('complete -c ns -n "__ns_needs_snapshot_branch" -a "(__ns_branches)"');
    expect(script).toContain('complete -c ns -n "__ns_needs_snapshot_name" -a "(__ns_snapshot_names)"');
  });

  test("snapshot completion is positional for fish", () => {
    const script = renderFishCompletion(["FEAT-123"], "/tmp/worktrees", "/tmp/snapshots");
    expect(script).not.toContain('__fish_seen_subcommand_from snapshot restore rm-snapshot snapshots');
    expect(script).not.toContain('__fish_seen_subcommand_from restore rm-snapshot" -a "(__ns_snapshot_names)"');
    expect(script).not.toContain('contains -- $tokens[4] (__ns_branches)');
  });

  test("snapshot completion uses correct json regex for fish", () => {
    const script = renderFishCompletion(["FEAT-123"], "/tmp/worktrees", "/tmp/snapshots");
    expect(script).toContain("string match -r '.*\\.json$'");
    expect(script).toContain("string replace -r '\\.json$' ''");
    expect(script).not.toContain("string match -r '\\\\.json$'");
    expect(script).not.toContain("string match -r '\\.json$'");
  });

  test("snapshot completion checks snapshots directory for fish activation", () => {
    const script = renderFishCompletion(["FEAT-123"], "/tmp/worktrees", "/tmp/snapshots");
    expect(script).toContain('test -n "$tokens[4]" -a -d "/tmp/snapshots/$tokens[4]"');
    expect(script).not.toContain('contains -- $tokens[4] (__ns_branches)');
  });

  test("db subcommand function stops suggesting when subcommand is complete", () => {
    const script = renderFishCompletion(["FEAT-123"], "/tmp/worktrees");
    expect(script).toMatch(/__ns_needs_db_subcommand[\s\S]*?if not contains -- \$tokens\[3\]/);
  });

  test("add subcommand function stops when manager is complete", () => {
    const script = renderFishCompletion(["FEAT-123"], "/tmp/worktrees");
    expect(script).toMatch(/__ns_needs_add_subcommand[\s\S]*?if not contains -- \$tokens\[3\]/);
  });

  test("workspace subcommand function stops when template is complete", () => {
    const script = renderFishCompletion(["FEAT-123"], "/tmp/worktrees");
    expect(script).toMatch(/__ns_needs_workspace_subcommand[\s\S]*?if not contains -- \$tokens\[3\]/);
  });

  test("workspace template subcommand stops when save/apply is complete", () => {
    const script = renderFishCompletion(["FEAT-123"], "/tmp/worktrees");
    expect(script).toMatch(/__ns_needs_workspace_template_subcommand[\s\S]*?if not contains -- \$tokens\[4\]/);
  });
});

describe("completion bash", () => {
  test("db restore and rm-snapshot complete snapshot names", () => {
    const script = renderBashCompletion(["FEAT-123"], "/tmp/snapshots");
    expect(script).toContain('_ns_snapshot_names()');
    expect(script).toContain('/tmp/snapshots');
    expect(script).toContain('restore|rm-snapshot');
    expect(script).toContain('printf "%s\\n" latest');
  });

  test("add manager completes branches", () => {
    const script = renderBashCompletion(["FEAT-123"], "/tmp/snapshots");

    expect(script).toContain('local add_subs="manager"');
    expect(script).toContain('if [ "${COMP_WORDS[2]}" = "manager" ] && [ $COMP_CWORD -eq 3 ]; then');
    expect(script).not.toContain('COMPREPLY=( $(compgen -W "$branches" -- "$cur") )\n}');
  });

  test("workspace template completes branches positionally", () => {
    const script = renderBashCompletion(["FEAT-123"], "/tmp/snapshots");

    expect(script).toContain('local ws_template_subs="save apply"');
    expect(script).toContain('[ "${COMP_WORDS[2]}" = "template" ]');
    expect(script).toContain('save|apply');
  });
});

describe("completion zsh", () => {
  test("db restore and rm-snapshot complete snapshot names", () => {
    const script = renderZshCompletion(["FEAT-123"], "/tmp/snapshots");
    expect(script).toContain('_ns_snapshot_names()');
    expect(script).toContain('/tmp/snapshots');
    expect(script).toContain('snapshot_names=(');
    expect(script).toContain('restore|rm-snapshot');
  });

  test("add manager completes branches", () => {
    const script = renderZshCompletion(["FEAT-123"], "/tmp/snapshots");

    expect(script).toContain('local -a add_subs=("manager")');
    expect(script).toContain('case "$words[2]" in');
    expect(script).toContain('add)');
    expect(script).toContain('[[ "$words[3]" == "manager" ]] && (( CURRENT == 4 ))');
    expect(script).toContain("_describe 'branch' branches");
  });
});
