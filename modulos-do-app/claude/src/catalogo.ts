import { createPublicKey, verify } from 'node:crypto'
import type { ItemClaude, TipoClaude } from '../../compartilhado/src/claude'
import { ASSINATURA_FORMATO, CHAVE_PUBLICA } from '../../marketplace/src/assinatura'
import { REPOSITORIO } from '../../marketplace/src/catalogo'

// Catálogo de skills e plugins públicos do Claude (claude-catalogo.json no repositório do marketplace). Cada item é APROVADO pelo mantenedor:
// a assinatura Ed25519 cobre o tipo, o id, o repositório de origem, o commit fixado e o caminho, então quem só consegue escrever no repositório
// não consegue trocar a origem de um item. A chave é a mesma do marketplace de módulos. Lógica pura (sem rede e sem disco).

export const URL_CATALOGO_CLAUDE = `https://raw.githubusercontent.com/${REPOSITORIO}/main/claude-catalogo.json`

const ID = /^[a-z][a-z0-9-]{0,47}$/
const REPO = /^[A-Za-z0-9_.-]{1,60}\/[A-Za-z0-9_.-]{1,100}$/
const COMMIT = /^[0-9a-f]{40}$/
const NOME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/
const CAMINHO = /^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)*$/

/** O texto exato que é assinado. Mantenha igual ao de scripts/assinar-catalogo-claude.mjs. */
export const mensagemItem = (e: Pick<ItemClaude, 'tipo' | 'id' | 'repo' | 'ref' | 'caminho' | 'marketplace' | 'plugin'>): string =>
  ['memoritrix-claude-v1', e.tipo, e.id, e.repo, e.ref ?? '', e.caminho ?? '', e.marketplace ? `${e.marketplace.nome}@${e.marketplace.repo}` : '', e.plugin ?? ''].join('\n')

export function assinaturaDoItemConfere(e: ItemClaude, chave = CHAVE_PUBLICA): boolean {
  try {
    if (!ASSINATURA_FORMATO.test(e.assinatura)) return false
    const pub = createPublicKey({ key: Buffer.from(chave, 'base64'), format: 'der', type: 'spki' })
    return verify(null, Buffer.from(mensagemItem(e), 'utf-8'), pub, Buffer.from(e.assinatura, 'base64'))
  } catch { return false }
}

/** Caminho dentro do repositório sem "..", sem barra invertida, sem caminho absoluto. */
export const caminhoSeguro = (c: string): boolean => CAMINHO.test(c) && !c.split('/').some((p) => p === '..' || p === '.')

/** Cada item inválido é descartado sozinho (um item ruim não derruba o catálogo); devolve também os motivos. */
export function validarCatalogoClaude(bruto: unknown, chave: string = CHAVE_PUBLICA): { itens: ItemClaude[]; ignoradas: string[] } {
  const lista = bruto && typeof bruto === 'object' && Array.isArray((bruto as { itens?: unknown }).itens) ? (bruto as { itens: unknown[] }).itens : null
  if (!lista) throw new Error('Catálogo inválido: falta a lista "itens".')
  const itens: ItemClaude[] = []
  const ignoradas: string[] = []
  for (const e of lista) {
    const o = (e && typeof e === 'object' ? e : {}) as Record<string, unknown>
    const t = (k: string): string => (typeof o[k] === 'string' ? (o[k] as string).trim() : '')
    const id = t('id')
    const tipo = t('tipo') as TipoClaude
    const erros: string[] = []
    if (!ID.test(id)) erros.push('id inválido')
    if (tipo !== 'skill' && tipo !== 'plugin') erros.push('tipo inválido')
    if (!t('nome')) erros.push('sem nome')
    if (!REPO.test(t('repo'))) erros.push('repositório inválido')
    let marketplace: ItemClaude['marketplace']
    if (tipo === 'skill') {
      if (!COMMIT.test(t('ref'))) erros.push('commit fixado ausente (40 caracteres)')
      if (!t('caminho') || !caminhoSeguro(t('caminho'))) erros.push('caminho inválido')
    } else if (tipo === 'plugin') {
      const m = (o['marketplace'] && typeof o['marketplace'] === 'object' ? o['marketplace'] : {}) as Record<string, unknown>
      const nome = typeof m['nome'] === 'string' ? m['nome'].trim() : ''
      const repo = typeof m['repo'] === 'string' ? m['repo'].trim() : ''
      if (!NOME.test(nome) || !REPO.test(repo)) erros.push('marketplace inválido')
      else marketplace = { nome, repo }
      if (!NOME.test(t('plugin'))) erros.push('plugin inválido')
    }
    if (itens.some((x) => x.id === id && x.tipo === tipo)) erros.push('item repetido')
    const base: ItemClaude = {
      id, tipo, nome: t('nome'), descricao: t('descricao'), repo: t('repo'), assinatura: t('assinatura'),
      ...(t('ref') ? { ref: t('ref') } : {}), ...(t('caminho') ? { caminho: t('caminho') } : {}), ...(marketplace ? { marketplace } : {}),
      ...(t('plugin') ? { plugin: t('plugin') } : {}), ...(t('licenca') ? { licenca: t('licenca') } : {})
    }
    if (!erros.length && !assinaturaDoItemConfere(base, chave)) erros.push('assinatura ausente ou inválida')
    if (erros.length) { ignoradas.push(`${id || '(sem id)'}: ${erros.join(', ')}`); continue }
    itens.push(base)
  }
  return { itens, ignoradas }
}

/** Endereço do arquivo .zip da skill no commit fixado (o GitHub entrega sempre o mesmo conteúdo para o mesmo commit). */
export const urlDoArquivoDaSkill = (i: Pick<ItemClaude, 'repo' | 'ref'>): string => `https://codeload.github.com/${i.repo}/zip/${i.ref}`
