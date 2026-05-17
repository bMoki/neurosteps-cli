import { Command } from "commander";
import { SNAPSHOTS_DIR, WORKTREES_DIR, listBranches } from "../lib/config";
import { error, ok } from "../lib/logger";
import { mkdirSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const COMMANDS = [
  "init",
  "prepare",
  "start",
  "stop",
  "status",
  "portless",
  "add",
  "new",
  "rm",
  "open",
  "close",
  "doctor",
  "db",
  "workspace",
  "config",
  "completion",
  "help",
];

const BRANCH_COMMANDS = [
  "prepare",
  "start",
  "stop",
  "status",
  "portless",
  "rm",
  "open",
  "close",
  "doctor",
];

const COMPLETION_SHELLS = [
  "fish",
  "bash",
  "zsh",
  "install",
];

const DB_SUBCOMMANDS = [
  "start",
  "reset",
  "port",
  "logs",
  "snapshot",
  "restore",
  "snapshots",
  "rm-snapshot",
  "open",
];

const DB_BRANCH_SUBCOMMANDS = [
  "start",
  "reset",
  "port",
  "logs",
  "snapshot",
  "restore",
  "snapshots",
  "rm-snapshot",
  "open",
];

const DB_DIRECT_BRANCH_SUBCOMMANDS = [
  "start",
  "reset",
  "port",
  "logs",
  "open",
];

const DB_SNAPSHOT_NAME_SUBCOMMANDS = [
  "restore",
  "rm-snapshot",
];

const ADD_SUBCOMMANDS = [
  "manager",
];

const WORKSPACE_SUBCOMMANDS = [
  "template",
];

const WORKSPACE_TEMPLATE_SUBCOMMANDS = [
  "save",
  "apply",
];

const CONFIG_SUBCOMMANDS = [
  "env",
  "get",
  "set",
  "list",
  "detect-apps",
];

export function renderFishCompletion(
  branches: string[],
  worktreesDir = WORKTREES_DIR,
  snapshotsDir = SNAPSHOTS_DIR,
): string {
  void worktreesDir;
  const branchList = branches.join(" ");
  const commands = COMMANDS.join(" ");
  const branchCommands = BRANCH_COMMANDS.join(" ");
  const dbSubs = DB_SUBCOMMANDS.join(" ");
  const addSubs = ADD_SUBCOMMANDS.join(" ");
  const wsSubs = WORKSPACE_SUBCOMMANDS.join(" ");
  const wsTemplateSubs = WORKSPACE_TEMPLATE_SUBCOMMANDS.join(" ");
  const cfgSubs = CONFIG_SUBCOMMANDS.join(" ");
  const completionShells = COMPLETION_SHELLS.join(" ");

  return `
function __ns_branches
  printf "%s\\n" ${branchList}
end

function __ns_commands
  printf "%s\\n" ${commands}
end

function __ns_completion_shells
  printf "%s\\n" ${completionShells}
end

function __ns_db_subs
  printf "%s\\n" ${dbSubs}
end

function __ns_add_subs
  printf "%s\\n" ${addSubs}
end

function __ns_workspace_subs
  printf "%s\\n" ${wsSubs}
end

function __ns_workspace_template_subs
  printf "%s\\n" ${wsTemplateSubs}
end

function __ns_config_subs
  printf "%s\\n" ${cfgSubs}
end

function __ns_needs_command
  set -l tokens (commandline -opc)
  if test (count $tokens) -eq 1
    return 0
  end
  if test (count $tokens) -eq 2
    return 0
  end
  return 1
end

function __ns_needs_top_level_branch
  set -l tokens (commandline -opc)
  if test (count $tokens) -lt 2
    return 1
  end
  if not contains -- $tokens[2] ${branchCommands}
    return 1
  end
  if test (count $tokens) -eq 2
    return 0
  end
  if test (count $tokens) -eq 3
    return 0
  end
  return 1
end

function __ns_needs_completion_shell
  set -l tokens (commandline -opc)
  if test (count $tokens) -lt 2 -o "$tokens[2]" != "completion"
    return 1
  end
  if test (count $tokens) -eq 2
    return 0
  end
  if test (count $tokens) -eq 3
    return 0
  end
  return 1
end

function __ns_needs_add_subcommand
  set -l tokens (commandline -opc)
  if test (count $tokens) -lt 2 -o "$tokens[2]" != "add"
    return 1
  end
  if test (count $tokens) -eq 2
    return 0
  end
  if test (count $tokens) -eq 3
    return 0
  end
  return 1
end

function __ns_needs_add_branch
  set -l tokens (commandline -opc)
  if test (count $tokens) -lt 3 -o "$tokens[2]" != "add" -o "$tokens[3]" != "manager"
    return 1
  end
  if test (count $tokens) -eq 3
    return 0
  end
  if test (count $tokens) -eq 4
    return 0
  end
  return 1
end

function __ns_needs_db_subcommand
  set -l tokens (commandline -opc)
  if test (count $tokens) -lt 2 -o "$tokens[2]" != "db"
    return 1
  end
  if test (count $tokens) -eq 2
    return 0
  end
  if test (count $tokens) -eq 3
    return 0
  end
  return 1
end

function __ns_snapshot_branch
  set -l tokens (commandline -opc)
  for i in (seq (count $tokens))
    if contains -- $tokens[$i] snapshot restore rm-snapshot snapshots
      set -l branch_index (math $i + 1)
      if test $branch_index -le (count $tokens)
        echo $tokens[$branch_index]
      end
      return
    end
  end
end

function __ns_needs_snapshot_branch
  set -l tokens (commandline -opc)
  if test (count $tokens) -lt 3
    return 1
  end

  if test "$tokens[1]" != "ns" -o "$tokens[2]" != "db"
    return 1
  end

  if not contains -- $tokens[3] snapshot restore rm-snapshot snapshots
    return 1
  end

  if test (count $tokens) -eq 3
    return 0
  end

  if test (count $tokens) -eq 4
    return 0
  end

  if test (count $tokens) -eq 4 -a -n "$tokens[4]"
    return 1
  end

  return 1
end

function __ns_needs_db_branch
  set -l tokens (commandline -opc)
  if test (count $tokens) -lt 3
    return 1
  end

  if test "$tokens[1]" != "ns" -o "$tokens[2]" != "db"
    return 1
  end

  if not contains -- $tokens[3] ${DB_DIRECT_BRANCH_SUBCOMMANDS.join(" ")}
    return 1
  end

  if test (count $tokens) -eq 3
    return 0
  end

  if test (count $tokens) -eq 4
    return 0
  end

  return 1
end

function __ns_snapshot_names
  set -l branch (__ns_snapshot_branch)
  if test -n "$branch" -a -d "${snapshotsDir}/$branch"
    command ls -1 "${snapshotsDir}/$branch" 2>/dev/null | string match -r '.*\\.json$' | string replace -r '\\.json$' ''
  end
  printf "%s\\n" latest
end

function __ns_needs_snapshot_name
  set -l tokens (commandline -opc)
  if test (count $tokens) -lt 4
    return 1
  end

  if test "$tokens[1]" != "ns" -o "$tokens[2]" != "db"
    return 1
  end

  if not contains -- $tokens[3] restore rm-snapshot
    return 1
  end

  if test -n "$tokens[4]" -a -d "${snapshotsDir}/$tokens[4]"
    return 0
  end

  if test (count $tokens) -ge 5 -a -n "$tokens[5]" -a -d "${snapshotsDir}/$tokens[5]"
    return 0
  end

  if test (count $tokens) -eq 4 -a -n "$tokens[4]"
    return 0
  end

  if test (count $tokens) -eq 5 -a -n "$tokens[4]"
    return 0
  end

  if test (count $tokens) -gt 5
    return 1
  end

  return 1
end

function __ns_needs_workspace_subcommand
  set -l tokens (commandline -opc)
  if test (count $tokens) -lt 2 -o "$tokens[2]" != "workspace"
    return 1
  end
  if test (count $tokens) -eq 2
    return 0
  end
  if test (count $tokens) -eq 3
    return 0
  end
  return 1
end

function __ns_needs_workspace_template_subcommand
  set -l tokens (commandline -opc)
  if test (count $tokens) -lt 3 -o "$tokens[2]" != "workspace" -o "$tokens[3]" != "template"
    return 1
  end
  if test (count $tokens) -eq 3
    return 0
  end
  if test (count $tokens) -eq 4
    return 0
  end
  return 1
end

function __ns_needs_workspace_template_branch
  set -l tokens (commandline -opc)
  if test (count $tokens) -lt 4 -o "$tokens[2]" != "workspace" -o "$tokens[3]" != "template"
    return 1
  end
  if not contains -- $tokens[4] ${wsTemplateSubs}
    return 1
  end
  if test (count $tokens) -eq 4
    return 0
  end
  if test (count $tokens) -eq 5
    return 0
  end
  return 1
end

function __ns_needs_config_subcommand
  set -l tokens (commandline -opc)
  if test (count $tokens) -lt 2 -o "$tokens[2]" != "config"
    return 1
  end
  if test (count $tokens) -eq 2
    return 0
  end
  if test (count $tokens) -eq 3
    return 0
  end
  return 1
end

complete -c ns -f
complete -c ns -n "__ns_needs_command" -a "(__ns_commands)"
complete -c ns -n "__ns_needs_top_level_branch" -a "(__ns_branches)"
complete -c ns -n "__ns_needs_completion_shell" -a "(__ns_completion_shells)"
complete -c ns -n "__ns_needs_add_subcommand" -a "(__ns_add_subs)"
complete -c ns -n "__ns_needs_add_branch" -a "(__ns_branches)"
complete -c ns -n "__ns_needs_db_subcommand" -a "(__ns_db_subs)"
complete -c ns -n "__ns_needs_db_branch" -a "(__ns_branches)"
complete -c ns -n "__ns_needs_snapshot_branch" -a "(__ns_branches)"
complete -c ns -n "__ns_needs_snapshot_name" -a "(__ns_snapshot_names)"
complete -c ns -n "__ns_needs_workspace_subcommand" -a "(__ns_workspace_subs)"
complete -c ns -n "__ns_needs_workspace_template_subcommand" -a "(__ns_workspace_template_subs)"
complete -c ns -n "__ns_needs_workspace_template_branch" -a "(__ns_branches)"
complete -c ns -n "__ns_needs_config_subcommand" -a "(__ns_config_subs)"
`;
}

export function renderBashCompletion(
  branches: string[],
  snapshotsDir = SNAPSHOTS_DIR,
): string {
  return `
_ns_completions() {
  local cur=\${COMP_WORDS[COMP_CWORD]}
  local cmds="${COMMANDS.join(" ")}"
  local branches="${branches.join(" ")}"
  local db_subs="${DB_SUBCOMMANDS.join(" ")}"
  local add_subs="${ADD_SUBCOMMANDS.join(" ")}"
  local ws_subs="${WORKSPACE_SUBCOMMANDS.join(" ")}"
  local ws_template_subs="${WORKSPACE_TEMPLATE_SUBCOMMANDS.join(" ")}"
  local cfg_subs="${CONFIG_SUBCOMMANDS.join(" ")}"
  local completion_shells="${COMPLETION_SHELLS.join(" ")}"
  local snapshots_dir="${snapshotsDir}"
  local branch=""

  _ns_snapshot_names() {
    local branch_name="$1"
    if [ -d "$snapshots_dir/$branch_name" ]; then
      command ls -1 "$snapshots_dir/$branch_name" 2>/dev/null | command sed -n 's/\\.json$//p'
    fi
    printf "%s\\n" latest
  }

  if [ $COMP_CWORD -eq 1 ]; then
    COMPREPLY=( $(compgen -W "$cmds" -- "$cur") )
    return
  fi

  case "\${COMP_WORDS[1]}" in
    ${BRANCH_COMMANDS.join("|")})
      if [ $COMP_CWORD -eq 2 ]; then
        COMPREPLY=( $(compgen -W "$branches" -- "$cur") )
        return
      fi
      ;;
    completion)
      if [ $COMP_CWORD -eq 2 ]; then
        COMPREPLY=( $(compgen -W "$completion_shells" -- "$cur") )
        return
      fi
      ;;
    add)
      if [ $COMP_CWORD -eq 2 ]; then
        COMPREPLY=( $(compgen -W "$add_subs" -- "$cur") )
        return
      fi
      if [ "\${COMP_WORDS[2]}" = "manager" ] && [ $COMP_CWORD -eq 3 ]; then
        COMPREPLY=( $(compgen -W "$branches" -- "$cur") )
        return
      fi
      ;;
    db)
      if [ $COMP_CWORD -eq 2 ]; then
        COMPREPLY=( $(compgen -W "$db_subs" -- "$cur") )
        return
      fi

    case "\${COMP_WORDS[2]}" in
      ${DB_BRANCH_SUBCOMMANDS.join("|")})
        if [ $COMP_CWORD -eq 3 ]; then
          COMPREPLY=( $(compgen -W "$branches" -- "$cur") )
          return
        fi
        ;;
    esac

    case "\${COMP_WORDS[2]}" in
      ${DB_SNAPSHOT_NAME_SUBCOMMANDS.join("|")})
        if [ $COMP_CWORD -eq 4 ]; then
          branch="\${COMP_WORDS[3]}"
          COMPREPLY=( $(compgen -W "$( _ns_snapshot_names "$branch" )" -- "$cur") )
          return
        fi
        ;;
    esac

      ;;
    workspace)
      if [ $COMP_CWORD -eq 2 ]; then
        COMPREPLY=( $(compgen -W "$ws_subs" -- "$cur") )
        return
      fi
      if [ "\${COMP_WORDS[2]}" = "template" ]; then
        if [ $COMP_CWORD -eq 3 ]; then
          COMPREPLY=( $(compgen -W "$ws_template_subs" -- "$cur") )
          return
        fi
        case "\${COMP_WORDS[3]}" in
          ${WORKSPACE_TEMPLATE_SUBCOMMANDS.join("|")})
            if [ $COMP_CWORD -eq 4 ]; then
              COMPREPLY=( $(compgen -W "$branches" -- "$cur") )
              return
            fi
            ;;
        esac
      fi
      ;;
    config)
      if [ $COMP_CWORD -eq 2 ]; then
        COMPREPLY=( $(compgen -W "$cfg_subs" -- "$cur") )
        return
      fi
      ;;
  esac
}
complete -F _ns_completions ns
`;
}

export function renderZshCompletion(
  branches: string[],
  snapshotsDir = SNAPSHOTS_DIR,
): string {
  return `
#compdef ns
_ns() {
  local -a cmds=(${COMMANDS.map((c) => `"${c}"`).join(" ")})
  local -a branches=(${branches.map((b) => `"${b}"`).join(" ")})
  local -a db_subs=(${DB_SUBCOMMANDS.map((s) => `"${s}"`).join(" ")})
  local -a add_subs=(${ADD_SUBCOMMANDS.map((s) => `"${s}"`).join(" ")})
  local -a ws_subs=(${WORKSPACE_SUBCOMMANDS.map((s) => `"${s}"`).join(" ")})
  local -a ws_template_subs=(${WORKSPACE_TEMPLATE_SUBCOMMANDS.map((s) => `"${s}"`).join(" ")})
  local -a cfg_subs=(${CONFIG_SUBCOMMANDS.map((s) => `"${s}"`).join(" ")})
  local -a completion_shells=(${COMPLETION_SHELLS.map((s) => `"${s}"`).join(" ")})
  local snapshots_dir="${snapshotsDir}"
  local -a snapshot_names

  _ns_snapshot_names() {
    local branch="$1"
    if [[ -d "$snapshots_dir/$branch" ]]; then
      command ls -1 "$snapshots_dir/$branch" 2>/dev/null | command sed -n 's/\\.json$//p'
    fi
    printf "%s\\n" latest
  }

  if (( CURRENT == 2 )); then
    _describe 'command' cmds
    return
  fi

  case "$words[2]" in
    ${BRANCH_COMMANDS.join("|")})
      if (( CURRENT == 3 )); then
        _describe 'branch' branches
        return
      fi
      ;;
    completion)
      if (( CURRENT == 3 )); then
        _describe 'shell' completion_shells
        return
      fi
      ;;
    add)
      if (( CURRENT == 3 )); then
        _describe 'add subcommand' add_subs
        return
      fi
      if [[ "$words[3]" == "manager" ]] && (( CURRENT == 4 )); then
        _describe 'branch' branches
        return
      fi
      ;;
    db)
      if (( CURRENT == 3 )); then
        _describe 'db subcommand' db_subs
        return
      fi

      case "$words[3]" in
        ${DB_BRANCH_SUBCOMMANDS.join("|")})
          if (( CURRENT == 4 )); then
            _describe 'branch' branches
            return
          fi
          ;;
      esac

      case "$words[3]" in
        ${DB_SNAPSHOT_NAME_SUBCOMMANDS.join("|")})
          if (( CURRENT == 5 )); then
            snapshot_names=(\${(f)"$(_ns_snapshot_names "$words[4]")"})
            _describe 'snapshot' snapshot_names
            return
          fi
          ;;
      esac
      ;;
    workspace)
      if (( CURRENT == 3 )); then
        _describe 'workspace subcommand' ws_subs
        return
      fi
      if [[ "$words[3]" == "template" ]]; then
        if (( CURRENT == 4 )); then
          _describe 'template subcommand' ws_template_subs
          return
        fi
        case "$words[4]" in
          ${WORKSPACE_TEMPLATE_SUBCOMMANDS.join("|")})
            if (( CURRENT == 5 )); then
              _describe 'branch' branches
              return
            fi
            ;;
        esac
      fi
      ;;
    config)
      if (( CURRENT == 3 )); then
        _describe 'config subcommand' cfg_subs
        return
      fi
      ;;
  esac
}
compdef _ns ns
`;
}

function detectShell(): "fish" | "bash" | "zsh" | null {
  const shell = process.env.SHELL?.split("/").pop();
  return shell === "fish" || shell === "bash" || shell === "zsh" ? shell : null;
}

function installCompletion(shell: string, branches: string[]): void {
  const home = homedir();
  if (shell === "fish") {
    const dir = join(home, ".config/fish/completions");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "ns.fish"), renderFishCompletion(branches));
    ok("Autocomplete do fish instalado em ~/.config/fish/completions/ns.fish");
    return;
  }

  if (shell === "bash") {
    const dir = join(home, ".local/share/bash-completion/completions");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "ns"), renderBashCompletion(branches));
    ok("Autocomplete do bash instalado em ~/.local/share/bash-completion/completions/ns");
    return;
  }

  if (shell === "zsh") {
    const dir = join(home, ".zfunc");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "_ns"), renderZshCompletion(branches));
    ok("Autocomplete do zsh instalado em ~/.zfunc/_ns");
    return;
  }

  error(`Shell não suportado: ${shell}. Use fish, bash ou zsh.`);
  process.exit(1);
}

export function completionCommand(): Command {
  return new Command("completion")
    .description("Gera script de autocomplete do shell")
    .argument("[shell]", "tipo do shell (fish, bash, zsh) ou install")
    .action((shell) => {
      const branches = listBranches();

      if (!shell || shell === "install") {
        installCompletion(detectShell() ?? "fish", branches);
        return;
      }

      if (shell === "fish") {
        console.log(renderFishCompletion(branches));
      } else if (shell === "bash") {
        console.log(renderBashCompletion(branches));
      } else if (shell === "zsh") {
        console.log(renderZshCompletion(branches));
      } else {
        error(`Shell não suportado: ${shell}. Use fish, bash ou zsh.`);
        process.exit(1);
      }
    });
}
