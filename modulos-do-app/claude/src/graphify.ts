import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// Graphify (github.com/Graphify-Labs/graphify): transforma um projeto num mapa que o Claude consulta em vez de reler os arquivos. É um projeto
// independente (Apache-2.0), instalado pelo uv a partir do PyPI. Aqui só detectamos e instalamos pelos DOIS comandos oficiais, sem shell e só
// depois do Sim do usuário. O extra "mcp" é necessário para os comandos de consulta (query/explain/path).

const exe = (nome: string): string => (process.platform === 'win32' ? `${nome}.exe` : nome)
const binUsuario = (nome: string): string => join(homedir(), '.local', 'bin', exe(nome))

export const caminhoDe = (nome: 'graphify' | 'uv'): string | null => {
  const c = [nome === 'graphify' ? process.env['GRAPHIFY_BIN'] ?? '' : '', binUsuario(nome)].filter(Boolean)
  return c.find((f) => existsSync(f)) ?? null
}
export const skillDoGraphify = (casa: string = homedir()): string => join(casa, '.claude', 'skills', 'graphify', 'SKILL.md')

export interface EstadoGraphify { instalado: boolean; skill: boolean; uv: boolean }
export const estadoDoGraphify = (): EstadoGraphify => ({ instalado: !!caminhoDe('graphify'), skill: existsSync(skillDoGraphify()), uv: !!caminhoDe('uv') })

function rodar(bin: string, args: string[], timeout: number): Promise<string> {
  return new Promise((ok, falha) => {
    execFile(bin, args, { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }, (erro, saida, err) => {
      if (erro) falha(new Error(`${err || saida || erro.message}`.trim().slice(-500)))
      else ok(`${saida}`.trim())
    })
  })
}

/** Os dois comandos oficiais: instala o programa (com o extra de consulta) e depois a skill /graphify no Claude Code. */
export async function instalarGraphify(): Promise<string> {
  const uv = caminhoDe('uv')
  if (!uv) throw new Error('O uv não está instalado. Instale com: winget install astral-sh.uv, e tente de novo.')
  await rodar(uv, ['tool', 'install', '--force', 'graphifyy[mcp]'], 5 * 60 * 1000)
  const g = caminhoDe('graphify')
  if (!g) throw new Error('O Graphify foi instalado, mas não achei o programa. Rode "uv tool update-shell" e reinicie o app.')
  await rodar(g, ['install', '--platform', 'claude'], 60 * 1000)
  return 'Graphify instalado, com a skill /graphify no Claude Code. Abra uma conversa nova no Claude para ela valer.'
}
