import type { ModuloContexto } from '@memoritrix/nucleo-modulos'
import type { AssistenteChat } from '@shared/tipos'

// Habilidades permanentes dos assistentes (inclusive o Memorix). Cada assunto que o assistente aprende vira uma habilidade que CRESCE:
// a cada coisa nova aprendida sobre ele entra mais um ponto, e o nível sobe. Tudo fica em ia-habilidades.json e é espelhado no arquivo
// skills_habil.md, na pasta de notas da Sinapse, que serve de mapa: antes de responder, o assistente consulta o que já sabe do assunto.

export const ARQUIVO_MAPA = 'skills_habil.md'
const ARQ = 'ia-habilidades.json'
const MAX_HABILIDADES = 80 // por assistente
const MAX_PONTOS = 40 // por habilidade
const MAX_BLOCO = 1400
const PONTOS_POR_NIVEL = 4
const NIVEL_MAX = 10

export interface Habilidade { id: string; agente: string; agenteNome: string; assunto: string; pontos: string[]; criada: string; atualizada: string; consultas: number }

const normalizar = (t: string): string => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
const limpar = (t: string, max: number): string => t.replace(/\s+/g, ' ').replace(/^[-–—•*\s]+/, '').trim().slice(0, max)
const PARADAS = new Set(['para', 'como', 'qual', 'quais', 'sobre', 'esse', 'essa', 'isso', 'voce', 'uma', 'uns', 'umas', 'com', 'que', 'dos', 'das', 'nos', 'nas', 'por', 'mais', 'muito', 'ser', 'tem', 'foi', 'sao', 'ate', 'seu', 'sua'])
const palavras = (t: string): string[] => normalizar(t).split(' ').filter((p) => p.length > 2 && !PARADAS.has(p))

export const nivelDe = (h: Pick<Habilidade, 'pontos'>): number => Math.min(NIVEL_MAX, 1 + Math.floor(h.pontos.length / PONTOS_POR_NIVEL))

export function lerHabilidades(ctx: ModuloContexto): Habilidade[] {
  const l = ctx.dados.lerJson<Habilidade[]>(ARQ, [])
  return Array.isArray(l) ? l.filter((h) => h && typeof h.assunto === 'string' && Array.isArray(h.pontos) && typeof h.agente === 'string') : []
}

/** Procura, na resposta do modelo, as linhas `HABILIDADE: {"assunto": "...", "ponto": "..."}` e devolve o texto sem elas. */
export function extrairHabilidades(texto: string): { texto: string; aprendidas: { assunto: string; ponto: string }[] } {
  const aprendidas: { assunto: string; ponto: string }[] = []
  const limpo = texto.replace(/^[ \t]*HABILIDADE:[ \t]*(\{.*\})[ \t]*$/gm, (_m, json: string) => {
    try {
      const o = JSON.parse(json) as { assunto?: unknown; ponto?: unknown }
      const assunto = typeof o.assunto === 'string' ? limpar(o.assunto, 60) : ''
      const ponto = typeof o.ponto === 'string' ? limpar(o.ponto, 220) : ''
      if (assunto.length >= 3 && ponto.length >= 8) aprendidas.push({ assunto, ponto })
    } catch { /* linha malformada: some do texto mesmo assim */ }
    return ''
  })
  return { texto: limpo.replace(/\n{3,}/g, '\n\n').trim(), aprendidas }
}

/** Soma um ponto a uma habilidade do assistente (cria a habilidade se o assunto é novo). Devolve a habilidade, ou null se o ponto já era conhecido. */
export function registrarHabilidade(ctx: ModuloContexto, ass: AssistenteChat, assunto: string, ponto: string): Habilidade | null {
  const a = limpar(assunto, 60)
  const p = limpar(ponto, 220)
  if (a.length < 3 || p.length < 8) return null
  const todas = lerHabilidades(ctx)
  const agora = new Date().toISOString()
  const chaveA = normalizar(a)
  let h = todas.find((x) => x.agente === ass.id && normalizar(x.assunto) === chaveA)
  if (h) {
    if (h.pontos.some((x) => normalizar(x) === normalizar(p))) return null
    h.pontos = [...h.pontos, p].slice(-MAX_PONTOS)
    h.atualizada = agora
    h.agenteNome = ass.nome
  } else {
    h = { id: `h${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`, agente: ass.id, agenteNome: ass.nome, assunto: a, pontos: [p], criada: agora, atualizada: agora, consultas: 0 }
    todas.push(h)
    const dele = todas.filter((x) => x.agente === ass.id)
    if (dele.length > MAX_HABILIDADES) { // passou do limite: sai a menos mexida
      const sai = [...dele].sort((x, y) => x.atualizada.localeCompare(y.atualizada))[0]
      todas.splice(todas.indexOf(sai), 1)
    }
  }
  ctx.dados.gravarJson(ARQ, todas)
  espelhar(ctx, todas)
  return h
}

export function esquecerHabilidade(ctx: ModuloContexto, agente: string, habilidadeId?: string): void {
  const todas = lerHabilidades(ctx).filter((h) => !(h.agente === agente && (!habilidadeId || h.id === habilidadeId)))
  ctx.dados.gravarJson(ARQ, todas)
  espelhar(ctx, todas)
}

/** O mapa em Markdown: um bloco por assistente, uma seção por habilidade com o nível e os pontos aprendidos. */
export function montarMapa(todas: Habilidade[]): string {
  const linhas = [
    '# skills_habil — mapa de habilidades dos agentes', '',
    'Gerado automaticamente. Cada assunto que um agente aprende vira uma habilidade que cresce com o uso; antes de responder, o agente consulta este mapa. Não edite à mão: mude pelo menu do agente (Memória).', '',
    '#skills #habilidades #assistente', ''
  ]
  if (todas.length === 0) return [...linhas, '_Nenhum agente aprendeu uma habilidade ainda._', ''].join('\n')
  const porAgente = new Map<string, Habilidade[]>()
  for (const h of todas) porAgente.set(h.agente, [...(porAgente.get(h.agente) ?? []), h])
  for (const lista of porAgente.values()) {
    linhas.push(`## ${lista[0].agenteNome}`, '')
    for (const h of [...lista].sort((a, b) => nivelDe(b) - nivelDe(a) || b.atualizada.localeCompare(a.atualizada))) {
      linhas.push(`### ${h.assunto}`, `Nível ${nivelDe(h)} de ${NIVEL_MAX} · ${h.pontos.length} ${h.pontos.length === 1 ? 'ponto' : 'pontos'} · atualizada em ${new Date(h.atualizada).toLocaleDateString('pt-BR')}`, '')
      for (const p of h.pontos) linhas.push(`- ${p}`)
      linhas.push('')
    }
  }
  return linhas.join('\n')
}

function espelhar(ctx: ModuloContexto, todas: Habilidade[]): void {
  try {
    const escrever = ctx.servicos.obter<(nome: string, texto: string) => { ok: boolean }>('painel.escreverArquivo')
    escrever?.(ARQUIVO_MAPA, montarMapa(todas))
  } catch { /* sem Sinapse: as habilidades continuam valendo no JSON */ }
}

/** Habilidades relevantes ao pedido: as do próprio assistente primeiro, depois as dos outros (o mapa é de todos). Cada uma só entra se compartilha assunto com o pedido. */
export function habilidadesRelevantes(todas: Habilidade[], agente: string, pedido: string, max = 3): Habilidade[] {
  const q = new Set(palavras(pedido))
  if (q.size === 0) return []
  const pontuar = (h: Habilidade): number => {
    const assunto = palavras(h.assunto)
    const noAssunto = assunto.filter((p) => q.has(p)).length
    const nosPontos = new Set(h.pontos.flatMap(palavras))
    const comuns = [...q].filter((p) => nosPontos.has(p)).length
    if (noAssunto === 0 && comuns < 2) return 0 // sem o assunto e com pouca coincidência: não é sobre isso
    return noAssunto * 3 + comuns + (h.agente === agente ? 2 : 0)
  }
  return todas.map((h) => [h, pontuar(h)] as const).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, max).map(([h]) => h)
}

/** Bloco do prompt com o que o assistente já sabe do assunto (vazio se nada se aplica). */
export function blocoDeHabilidades(achadas: Habilidade[], agente: string): string {
  if (achadas.length === 0) return ''
  const linhas: string[] = []
  let total = 0
  for (const h of achadas) {
    const de = h.agente === agente ? 'sua habilidade' : `habilidade de ${h.agenteNome}`
    const cab = `- ${h.assunto} (${de}, nível ${nivelDe(h)}):`
    const pontos = h.pontos.slice(-8).map((p) => `  • ${p}`)
    const bloco = [cab, ...pontos].join('\n')
    if (total + bloco.length > MAX_BLOCO) break
    total += bloco.length
    linhas.push(bloco)
  }
  return linhas.length ? ['Do mapa de habilidades (skills_habil.md), o que já se sabe deste assunto; use como base e corrija se o usuário disser o contrário:', ...linhas].join('\n') : ''
}

/** Conta uma consulta em cada habilidade usada (para o usuário ver quais servem de verdade). */
export function contarConsulta(ctx: ModuloContexto, ids: string[]): void {
  if (ids.length === 0) return
  const todas = lerHabilidades(ctx)
  for (const h of todas) if (ids.includes(h.id)) h.consultas = (h.consultas ?? 0) + 1
  ctx.dados.gravarJson(ARQ, todas)
}

/** Habilidades que todo assistente já nasce sabendo (inclusive o Memorix). Entram uma vez só por assistente e crescem como as outras. */
const HABILIDADES_DE_NASCENCA: { assunto: string; pontos: string[] }[] = [
  {
    assunto: 'Mapa do projeto (Graphify)',
    pontos: [
      'Para entender um projeto grande, consulte o mapa (graphify-out/graph.json) com a ferramenta mapa_consultar antes de abrir arquivos: gasta bem menos tokens.',
      'Se a pasta ainda não tem mapa, crie com mapa_criar: lê só o código, no computador do usuário, sem usar IA, e precisa do Sim dele.',
      'mapa_consultar tem três modos: query (pergunta livre sobre o projeto), explain (um nó e os vizinhos dele) e path (o caminho mais curto entre dois nós).',
      'O mapa não substitui o código: para mudar um arquivo, abra esse arquivo; o mapa só diz qual abrir.',
      'Depois de mudanças grandes no projeto, atualize o mapa com mapa_criar de novo; só o que mudou é relido.'
    ]
  }
]

/** Dá ao assistente as habilidades de nascença que ele ainda não tem (não repete, e respeita as que o usuário esquecer: só semeia a primeira vez). */
export function semearHabilidades(ctx: ModuloContexto, ass: AssistenteChat): void {
  const semeados = ctx.dados.lerJson<string[]>('ia-habilidades-semeadas.json', [])
  if (semeados.includes(ass.id)) return
  for (const h of HABILIDADES_DE_NASCENCA) for (const p of h.pontos) registrarHabilidade(ctx, ass, h.assunto, p)
  ctx.dados.gravarJson('ia-habilidades-semeadas.json', [...semeados, ass.id])
}

/** Instrução curta que ensina o assistente a registrar o que aprendeu, com no máximo uma linha por resposta. */
export const INSTRUCAO_HABILIDADE =
  'Habilidades: se nesta resposta você aprendeu ou confirmou algo novo e útil sobre um ASSUNTO (um fato, regra ou jeito de fazer que valha lembrar), termine a resposta com UMA linha extra, sozinha, neste formato exato: ' +
  'HABILIDADE: {"assunto": "nome curto do assunto", "ponto": "o que você aprendeu, em uma frase"}. Não escreva essa linha em conversa comum, nem repita algo que você já sabia.'
