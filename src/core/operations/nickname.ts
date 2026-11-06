import { join } from "path";
import { WORKTREES_DIR, branchExists as defaultBranchExists } from "../../lib/config";
import type { NsContext } from "../context";
import { asNsError, naoEncontrado, preCondicao } from "../errors";

/** Tamanho máximo do Apelido, em caracteres, para caber na sidebar ao lado do nome da branch. */
export const NICKNAME_MAX_LENGTH = 40;

export interface SetNicknameInput {
  branch: string;
  nickname: string;   // vazio (ou só espaços) tira o Apelido
}

export interface SetNicknameResult {
  branch: string;
  nickname: string | null;
}

export interface NicknameDeps {
  branchExists: typeof defaultBranchExists;
  write: (path: string, text: string) => Promise<void>;
  remove: (path: string) => Promise<void>;
}

const defaultDeps: NicknameDeps = {
  branchExists: defaultBranchExists,
  write: async (path, text) => { await Bun.write(path, text); },
  remove: async (path) => {
    const file = Bun.file(path);
    if (await file.exists()) await file.delete();
  },
};

const graphemes = new Intl.Segmenter("pt-BR", { granularity: "grapheme" });

/** Caracteres como a pessoa os vê: um acento ou um emoji compostos contam como um. */
export function nicknameLength(text: string): number {
  return [...graphemes.segment(text)].length;
}

/** Arquivo do Apelido, dentro da pasta da branch: sai junto com ela no `ns rm`. */
export function nicknameFile(branch: string): string {
  return join(WORKTREES_DIR, branch, ".nickname");
}

/** Apelido como é guardado: uma linha, sem espaços nas pontas; vazio é a ausência de Apelido. */
export function normalizeNickname(text: string): string | null {
  const line = text.replace(/[\r\n]+/g, " ").trim();
  return line.length > 0 ? line : null;
}

/** Lê o Apelido da branch; sem arquivo, ou com arquivo vazio, a branch não tem Apelido. */
export async function readNickname(branch: string): Promise<string | null> {
  try {
    return normalizeNickname(await Bun.file(nicknameFile(branch)).text());
  } catch {
    return null;
  }
}

/**
 * Apelidar: dá, troca ou tira o Apelido de uma Branch de workspace. O Apelido é só um rótulo
 * para ver: não toca no nome da branch, na pasta, no banco, nas portas nem nas URLs.
 */
export async function runSetNickname(
  input: SetNicknameInput,
  _ctx: NsContext,
  deps: Partial<NicknameDeps> = {},
): Promise<SetNicknameResult> {
  const d = { ...defaultDeps, ...deps };
  const { branch } = input;
  if (!d.branchExists(branch)) {
    throw naoEncontrado(`Branch '${branch}' não encontrada`, "Rode 'ns status' para ver as branches disponíveis.");
  }
  const nickname = normalizeNickname(input.nickname);
  if (nickname && nicknameLength(nickname) > NICKNAME_MAX_LENGTH) {
    throw preCondicao(`O Apelido tem mais de ${NICKNAME_MAX_LENGTH} caracteres`, "Use um Apelido mais curto.");
  }
  const file = nicknameFile(branch);
  await (nickname ? d.write(file, `${nickname}\n`) : d.remove(file)).catch((error) => { throw asNsError(error); });
  return { branch, nickname };
}
