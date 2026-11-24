import type { ModuloContexto } from '@memoritrix/nucleo-modulos'
import type { AssistenteChat, LicaoAssistente } from '@shared/tipos'

// Memória de cada assistente: o que ele aprendeu com as correções e preferências do usuário e as habilidades que já usou com sucesso.
// Fica em um arquivo por assistente (ia-memoria-<id>.json), entra no prompt das próximas conversas e é copiada para a Sinapse como nota
// (tag #aprendizado), onde aparece no cérebro e pode ser lida por outras IAs. Nada disso sai do computador por conta própria.

const MAX_LICOES = 60
const NO_PROMPT = 12 // lições mais recentes enviadas junto com cada pergunta
const MAX_TEXTO = 180
const MAX_BLOCO = 1500

const arquivo = (id: string): string => `ia-memoria-${id.replace(/[^a-z0-9-]/gi, '').slice(0, 40) || 'x'}.json`
const normalizar = (t: string): string => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
const limpar = (t: string): string => t.replace(/\s+/g, ' ').replace(/^[-–—•*\s]+/, '').trim().slice(0, MAX_TEXTO)

export function lerMemoria(ctx: ModuloContexto, id: string): LicaoAssistente[] {
  const l = ctx.dados.lerJson<LicaoAssistente[]>(arquivo(id), [])
  return Array.isArray(l) ? l.filter((x) => x && typeof x.texto === 'string' && typeof x.id === 'string') : []
}
const gravar = (ctx: ModuloContexto, id: string, l: LicaoAssistente[]): void => ctx.dados.gravarJson(arquivo(id), l)

/** A mensagem do usuário corrige o assistente ou diz como ele prefere as coisas? Devolve o tipo da lição, ou null para conversa comum. */
export function tipoDeLicao(mensagem: string): 'correcao' | 'preferencia' | null {
  const t = normalizar(mensagem)
  if (t.length < 8 || t.length > 600) return null
  if (/\b(de agora em diante|daqui pra frente|daqui para frente|sempre que|sempre responda|sempre faca|sempre use|nunca mais|nunca responda|nunca faca|nunca use|lembre se|lembre-se|guarde isso|anote isso|aprenda que|prefiro|eu gosto que|eu quero que voce sempre|nao quero que voce)\b/.test(t)) return 'preferencia'
  if (/^(nao|errado|incorreto|na verdade|nao era|nao foi isso|voce errou|ta errado|esta errado|corrigindo|so que|mas eu pedi|eu pedi|eu disse)\b/.test(t) || /\b(voce errou|esta errado|ta errado|nao e isso|nao era isso|nao foi isso que|corrija|corrigindo|errou)\b/.test(t)) return 'correcao'
  return null
}

/** Lição de habilidade a partir de uma tarefa que o assistente executou com ferramentas: o tipo de pedido e o que funcionou. */
export function licaoDeHabilidade(pedido: string, ferramentas: { name: string; ok: boolean }[]): string | null {
  const ok = [...new Set(ferramentas.filter((f) => f.ok).map((f) => f.name))]
  if (ok.length === 0) return null
  return limpar(`Para pedidos como "${limpar(pedido).slice(0, 70)}", funcionou usar: ${ok.join(', ')}.`)
}

/** Guarda uma lição (sem repetir as parecidas) e copia para a Sinapse. Devolve a lição nova, ou null se já existia ou é inválida. */
export function aprender(ctx: ModuloContexto, ass: AssistenteChat, texto: string, tipo: LicaoAssistente['tipo']): LicaoAssistente | null {
  const t = limpar(texto)
  if (t.length < 6) return null
  const chave = normalizar(t)
  const lista = lerMemoria(ctx, ass.id)
  if (lista.some((x) => normalizar(x.texto) === chave)) return null
  const licao: LicaoAssistente = { id: `l${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`, texto: t, tipo, em: new Date().toISOString() }
  gravar(ctx, ass.id, [...lista, licao].slice(-MAX_LICOES))
  try {
    const criar = ctx.servicos.obter<(titulo: string, texto: string) => { ok: boolean }>('painel.criarNota')
    const rotulo = tipo === 'habilidade' ? 'Habilidade' : tipo === 'preferencia' ? 'Preferência' : 'Correção'
    criar?.(`${rotulo} de ${ass.nome}: ${t.slice(0, 50)}`, `${t}\n\nAprendido por ${ass.nome} em ${new Date().toLocaleDateString('pt-BR')}.\n\n#aprendizado #${tipo} #assistente`)
  } catch { /* sem Sinapse: a memória do assistente continua valendo */ }
  return licao
}

/** Bloco para o prompt: as lições mais recentes, como regras que o assistente deve seguir. Vazio se não há nenhuma. */
export function blocoDeMemoria(lista: LicaoAssistente[]): string {
  if (lista.length === 0) return ''
  let total = 0
  const linhas: string[] = []
  for (const l of lista.slice(-NO_PROMPT).reverse()) {
    const linha = `- ${l.texto}`
    if (total + linha.length > MAX_BLOCO) break
    total += linha.length
    linhas.push(linha)
  }
  return ['O que você já aprendeu com este usuário (correções, preferências e habilidades; siga):', ...linhas.reverse()].join('\n')
}

export function esquecer(ctx: ModuloContexto, id: string, licaoId?: string): void {
  gravar(ctx, id, licaoId ? lerMemoria(ctx, id).filter((l) => l.id !== licaoId) : [])
}
