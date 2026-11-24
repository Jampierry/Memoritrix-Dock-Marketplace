import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import type { DestinoClaude, ItemClaude } from '../../compartilhado/src/claude'
import { lerZip } from '../../marketplace/src/zip'

// Instalação no Claude Code (que o VS Code também usa). Duas coisas, ambas só em arquivos do usuário e sem rodar nenhum comando:
//  • SKILL  → a pasta da skill é copiada para <.claude>/skills/<id>/ (o conteúdo vem do commit fixado e aprovado no catálogo);
//  • PLUGIN → o marketplace e o plugin entram em <.claude>/settings.json (extraKnownMarketplaces e enabledPlugins); o próprio Claude Code
//             baixa o plugin na próxima vez que abrir, como se você tivesse instalado por ele.
// Nada que não veio daqui é apagado ou trocado: as skills instaladas levam uma marca, e o settings.json guarda uma cópia na primeira alteração.

export const MARCA = '.memoritrix-origem.json'
const COPIA = 'settings.json.memoritrix.bak'

/** A pasta .claude do destino: a do usuário (~/.claude) ou a do projeto escolhido (<projeto>/.claude). */
export function pastaClaude(destino: DestinoClaude, projeto?: string | null, casa: string = homedir()): string {
  if (destino === 'usuario') return join(casa, '.claude')
  if (!projeto || !projeto.trim()) throw new Error('Escolha a pasta do projeto aberto no VS Code.')
  return join(resolve(projeto), '.claude')
}

const idDePasta = (id: string): string => id.replace(/[^a-z0-9-]/g, '')

// ---------------------------------------------------------------- skills

export const pastaDaSkill = (base: string, id: string): string => join(base, 'skills', idDePasta(id))
export const skillInstalada = (base: string, id: string): boolean => existsSync(join(pastaDaSkill(base, id), MARCA))

/** Copia a pasta da skill de dentro do .zip do repositório. Só arquivos de dentro da pasta; nada de caminho fora dela. */
export function instalarSkill(item: ItemClaude, zip: Buffer, base: string, agora: () => Date = () => new Date()): { arquivos: number; pasta: string } {
  if (item.tipo !== 'skill' || !item.caminho) throw new Error('Este item não é uma skill.')
  const entradas = lerZip(zip)
  const raiz = entradas.find((e) => e.pasta && !e.nome.replace(/\/$/, '').includes('/'))?.nome ?? entradas[0]?.nome.split('/')[0] + '/'
  const prefixo = `${raiz.replace(/\/$/, '')}/${item.caminho.replace(/^\/|\/$/g, '')}/`
  const doItem = entradas.filter((e) => !e.pasta && e.nome.startsWith(prefixo))
  if (!doItem.some((e) => e.nome === `${prefixo}SKILL.md`)) throw new Error('O pacote não tem o SKILL.md esperado; nada foi instalado.')

  const destino = pastaDaSkill(base, item.id)
  if (existsSync(destino) && !existsSync(join(destino, MARCA))) throw new Error(`Já existe uma skill "${item.id}" que não veio deste catálogo. Renomeie ou remova a sua antes de instalar.`)
  const skills = join(base, 'skills')
  mkdirSync(skills, { recursive: true })
  const temp = join(skills, `.instalando-${idDePasta(item.id)}-${Date.now().toString(36)}`)
  try {
    for (const e of doItem) {
      const alvo = resolve(temp, e.nome.slice(prefixo.length))
      if (alvo !== resolve(temp) && !alvo.startsWith(resolve(temp) + sep)) throw new Error('Pacote com caminho inseguro; nada foi instalado.')
      mkdirSync(dirname(alvo), { recursive: true })
      writeFileSync(alvo, e.dados)
    }
    writeFileSync(join(temp, MARCA), JSON.stringify({ id: item.id, repo: item.repo, ref: item.ref, caminho: item.caminho, instaladoEm: agora().toISOString(), por: 'Memoritrix Dock' }, null, 2), 'utf-8')
    if (existsSync(destino)) rmSync(destino, { recursive: true, force: true })
    renameSync(temp, destino)
  } catch (e) {
    rmSync(temp, { recursive: true, force: true })
    throw e
  }
  return { arquivos: doItem.length, pasta: destino }
}

/** Remove só a skill que este app instalou (a que tem a marca). */
export function removerSkill(base: string, id: string): boolean {
  const pasta = pastaDaSkill(base, id)
  if (!existsSync(join(pasta, MARCA))) return false
  rmSync(pasta, { recursive: true, force: true })
  return true
}

/** As skills que este app instalou em <.claude>/skills. */
export function skillsInstaladas(base: string): string[] {
  try { return readdirSync(join(base, 'skills')).filter((n) => existsSync(join(base, 'skills', n, MARCA))) } catch { return [] }
}

// ---------------------------------------------------------------- plugins (settings.json)

interface Configuracao { extraKnownMarketplaces?: Record<string, unknown>; enabledPlugins?: Record<string, unknown>; [k: string]: unknown }

const arquivoConfig = (base: string): string => join(base, 'settings.json')

function lerConfig(base: string): Configuracao {
  const f = arquivoConfig(base)
  if (!existsSync(f)) return {}
  const texto = readFileSync(f, 'utf-8').replace(/^﻿/, '')
  if (!texto.trim()) return {}
  let o: unknown
  try { o = JSON.parse(texto) } catch { throw new Error(`O ${f} não é um JSON válido; não alterei nada. Corrija o arquivo e tente de novo.`) }
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error(`O ${f} tem um formato inesperado; não alterei nada.`)
  return o as Configuracao
}

function gravarConfig(base: string, c: Configuracao): void {
  const f = arquivoConfig(base)
  mkdirSync(base, { recursive: true })
  if (existsSync(f) && !existsSync(join(base, COPIA))) copyFileSync(f, join(base, COPIA)) // a cópia da primeira vez: o seu arquivo como estava
  const temp = `${f}.tmp-${Date.now().toString(36)}`
  writeFileSync(temp, JSON.stringify(c, null, 2) + '\n', 'utf-8')
  renameSync(temp, f)
}

export const chaveDoPlugin = (i: Pick<ItemClaude, 'plugin' | 'marketplace'>): string => `${i.plugin}@${i.marketplace?.nome}`

export function pluginInstalado(base: string, item: ItemClaude): boolean {
  try { return lerConfig(base).enabledPlugins?.[chaveDoPlugin(item)] === true } catch { return false }
}

/** Liga o plugin no settings.json (e cadastra o marketplace dele, se ainda não estiver). Mantém tudo o mais como estava. */
export function instalarPlugin(item: ItemClaude, base: string): { arquivo: string } {
  if (item.tipo !== 'plugin' || !item.marketplace || !item.plugin) throw new Error('Este item não é um plugin.')
  const c = lerConfig(base)
  const mercados = { ...(c.extraKnownMarketplaces ?? {}) }
  if (!mercados[item.marketplace.nome]) mercados[item.marketplace.nome] = { source: { source: 'github', repo: item.marketplace.repo } }
  const ligados = { ...(c.enabledPlugins ?? {}), [chaveDoPlugin(item)]: true }
  gravarConfig(base, { ...c, extraKnownMarketplaces: mercados, enabledPlugins: ligados })
  return { arquivo: arquivoConfig(base) }
}

/** Desliga o plugin (tira a linha dele de enabledPlugins). O marketplace cadastrado fica, porque outros plugins podem usá-lo. */
export function removerPlugin(item: ItemClaude, base: string): boolean {
  const c = lerConfig(base)
  const k = chaveDoPlugin(item)
  if (!c.enabledPlugins || !(k in c.enabledPlugins)) return false
  const { [k]: _fora, ...resto } = c.enabledPlugins
  gravarConfig(base, { ...c, enabledPlugins: resto })
  return true
}
