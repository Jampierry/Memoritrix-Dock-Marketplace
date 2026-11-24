import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import type { ModuloContexto } from '@memoritrix/nucleo-modulos'
import { buscar, EXT_TEXTO, LIMITE_BYTES, type NotaIndexada } from './indexador'

// IA da Sinapse (opcional): resumir uma memória e responder perguntas usando as notas achadas. Usa o serviço "ia.perguntar" do módulo IA.
// ATENÇÃO: os trechos vão para as IAs da fila do OmniRoute (que podem ser serviços na internet). Por isso só funciona com a permissão do usuário.

type Res<T> = { ok: true; dados: T } | { ok: false; erro: string }
export type PerguntarIA = (prompt: string) => Promise<Res<string>>
interface Config { iaLerNotas: boolean }

const ARQ_CONFIG = 'painel-config.json'
const ARQ_RESUMOS = 'painel-resumos.json'
const TRECHO = 2000
const TOTAL_RESUMO = 6000

export function montarPromptResumo(titulo: string, texto: string): string {
  return [
    'Resuma a nota abaixo em português do Brasil, em no máximo 5 linhas curtas, destacando o essencial. Responda só com o resumo.',
    '', `Título: ${titulo}`, 'Nota:', texto.slice(0, TOTAL_RESUMO)
  ].join('\n')
}

export function montarPromptPergunta(pergunta: string, trechos: { titulo: string; texto: string }[]): string {
  const notas = trechos.map((t, i) => `[${i + 1}] ${t.titulo}\n${t.texto.slice(0, TRECHO)}`).join('\n\n')
  return [
    'Responda em português do Brasil, de forma curta, usando APENAS as notas abaixo. Cite o número da nota entre colchetes. Se as notas não bastarem, diga isso.',
    '', 'Notas:', notas, '', `Pergunta: ${pergunta}`
  ].join('\n')
}

/** Lê o começo do arquivo, só se ele for texto e estiver no índice (nunca um caminho qualquer vindo da interface). */
export function lerTrecho(n: NotaIndexada, max: number): string {
  if (!(EXT_TEXTO as readonly string[]).includes(extname(n.id).toLowerCase()) || n.tamanho > LIMITE_BYTES) return n.resumo
  try { return readFileSync(n.id, 'utf-8').slice(0, max) } catch { return n.resumo }
}

export function registrarResumos(ctx: ModuloContexto, notas: () => NotaIndexada[]): void {
  const config = (): Config => ({ iaLerNotas: ctx.dados.lerJson<Partial<Config>>(ARQ_CONFIG, {}).iaLerNotas === true })
  const ia = (): PerguntarIA | undefined => ctx.servicos.obter<PerguntarIA>('ia.perguntar')
  const porque = (): string | null => {
    if (!config().iaLerNotas) return 'Permita antes que a IA leia trechos das suas notas (no card, em "IA").'
    if (!ia()) return 'Ligue o módulo IA em Ajustes > Sistema para usar resumos e perguntas.'
    return null
  }

  ctx.ipc.tratar('painel:ia-config', (): Res<Config & { moduloIA: boolean }> => ({ ok: true, dados: { ...config(), moduloIA: !!ia() } }))
  ctx.ipc.tratar('painel:ia-permitir', (v): Res<Config> => {
    ctx.dados.gravarJson(ARQ_CONFIG, { iaLerNotas: v === true })
    return { ok: true, dados: config() }
  })
  ctx.ipc.tratar('painel:resumir', async (id): Promise<Res<string>> => {
    const bloqueio = porque(); if (bloqueio) return { ok: false, erro: bloqueio }
    const n = notas().find((x) => x.id === id)
    if (!n) return { ok: false, erro: 'Memória não encontrada. Peça para a Sinapse aprender de novo.' }
    const cache = ctx.dados.lerJson<Record<string, { texto: string; alterado: number }>>(ARQ_RESUMOS, {})
    if (cache[n.id]?.alterado === n.alterado) return { ok: true, dados: cache[n.id].texto }
    const r = await ia()!(montarPromptResumo(n.titulo, lerTrecho(n, TOTAL_RESUMO)))
    if (!r.ok) return r
    ctx.dados.gravarJson(ARQ_RESUMOS, { ...cache, [n.id]: { texto: r.dados, alterado: n.alterado } })
    return r
  })
  ctx.ipc.tratar('painel:perguntar', async (pergunta): Promise<Res<{ texto: string; fontes: { id: string; titulo: string }[] }>> => {
    const bloqueio = porque(); if (bloqueio) return { ok: false, erro: bloqueio }
    const p = typeof pergunta === 'string' ? pergunta.trim().slice(0, 500) : ''
    if (!p) return { ok: false, erro: 'Escreva uma pergunta.' }
    const achadas = buscar(notas(), p, 5)
    if (!achadas.length) return { ok: false, erro: 'Não achei nada nas suas notas sobre isso.' }
    const r = await ia()!(montarPromptPergunta(p, achadas.map((n) => ({ titulo: n.titulo, texto: lerTrecho(n, TRECHO) }))))
    if (!r.ok) return r
    return { ok: true, dados: { texto: r.dados, fontes: achadas.map((n) => ({ id: n.id, titulo: n.titulo })) } }
  })
}
