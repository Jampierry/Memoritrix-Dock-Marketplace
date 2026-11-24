import { app } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { Resultado } from '@shared/tipos'
import { BASE } from './omniroute'

// Geração de imagens pelo OmniRoute: só quando alguma IA conectada tem modelo de imagem (DALL·E, gpt-image, Imagen, Flux, Stable Diffusion…).
// Sem modelo de imagem, nada é inventado: o pedido segue para o chat de texto, que explica que não gera imagens.

const VERBO = String.raw`(?:gere|gerar|gera|crie|criar|cria|desenhe|desenhar|fa[cç]a|fazer|produza|monte|consegue|consegue\s+(?:gerar|criar|fazer|chegar)|pode\s+(?:gerar|criar|fazer)|quero|preciso\s+de|me\s+(?:d[eê]|mostre|manda|envie)|mostre|mostra)`
const OBJETO = String.raw`(?:imagem|imagens|foto|fotos|ilustra[cç][aã]o|desenho|logo|logotipo|[ií]cone|wallpaper|figura|arte)`
const PEDIDO = new RegExp(String.raw`\b${VERBO}\b[^.?!\n]{0,40}\b${OBJETO}\b`, 'i')

/** O texto pede uma imagem nova (gerar, criar, desenhar…)? */
export const ehPedidoDeImagem = (texto: string): boolean => PEDIDO.test(texto)

const ID_IMAGEM = /(dall-?e|gpt-image|imagen|flux|stable-?diffusion|sdxl|sd3|ideogram|recraft|midjourney|nano-?banana|cogview|playground|firefly|image)/i
const NAO_IMAGEM = /(vision|embed|image-?text|whisper|tts|audio|moderation|rerank)/i

/** Escolhe um modelo de imagem entre os ids do OmniRoute; com `provedor`, prefere os dele. */
export function modeloDeImagem(ids: string[], provedor?: string): string | undefined {
  const bons = ids.filter((id) => ID_IMAGEM.test(id) && !NAO_IMAGEM.test(id))
  return (provedor ? bons.find((id) => id.startsWith(`${provedor}/`)) : undefined) ?? bons[0]
}

const pasta = (): string => join(app.getPath('userData'), 'imagens')
export const NOME_IMAGEM = /^[a-z0-9-]{6,40}\.(png|jpg|webp)$/

/** Lê uma imagem gerada (referência `imagem:NOME`) como data URI; null se não existir ou o nome for inválido. */
export function lerImagemGerada(nome: string): string | null {
  if (!NOME_IMAGEM.test(nome)) return null
  try {
    const ext = nome.endsWith('.jpg') ? 'jpeg' : nome.split('.')[1]
    return `data:image/${ext};base64,${readFileSync(join(pasta(), nome)).toString('base64')}`
  } catch { return null }
}

function guardar(b64: string): string {
  const bytes = Buffer.from(b64, 'base64')
  const ext = bytes[0] === 0xff ? 'jpg' : bytes[0] === 0x52 ? 'webp' : 'png'
  const nome = `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}.${ext}`
  mkdirSync(pasta(), { recursive: true })
  writeFileSync(join(pasta(), nome), bytes)
  return nome
}

/**
 * Se o texto pede uma imagem e há modelo de imagem, gera e devolve a mensagem com a imagem.
 * Devolve null quando não se aplica (não é pedido de imagem ou nenhuma IA conectada gera imagens): o chamador segue com o chat de texto.
 */
export async function gerarSePedido(texto: string, provedor?: string): Promise<Resultado<{ texto: string; modelo: string }> | null> {
  if (!ehPedidoDeImagem(texto)) return null
  let ids: string[] = []
  try {
    const r = await fetch(`${BASE}/models`, { signal: AbortSignal.timeout(8000) })
    ids = ((await r.json()) as { data?: { id?: string }[] }).data?.map((m) => String(m.id ?? '')) ?? []
  } catch { return null }
  const modelo = modeloDeImagem(ids, provedor)
  if (!modelo) return null
  try {
    const r = await fetch(`${BASE}/images/generations`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(180000),
      body: JSON.stringify({ model: modelo, prompt: texto.slice(0, 4000), n: 1, size: '1024x1024', response_format: 'b64_json' })
    })
    if (!r.ok) return { ok: false, erro: `A IA de imagem (${modelo}) não aceitou o pedido (erro ${r.status}). Confira a chave dela em Ajustes > IA.` }
    const d = ((await r.json()) as { data?: { b64_json?: string; url?: string }[] }).data?.[0]
    const legenda = texto.replace(/[\][()\n]/g, ' ').slice(0, 80).trim()
    if (d?.b64_json) return { ok: true, dados: { texto: `Aqui está a imagem:\n![${legenda}](imagem:${guardar(d.b64_json)})`, modelo } }
    if (d?.url && /^https:\/\//i.test(d.url)) return { ok: true, dados: { texto: `Aqui está a imagem:\n![${legenda}](${d.url})`, modelo } }
    return { ok: false, erro: `A IA de imagem (${modelo}) não devolveu nenhuma imagem.` }
  } catch {
    return { ok: false, erro: `A IA de imagem (${modelo}) não respondeu a tempo.` }
  }
}
