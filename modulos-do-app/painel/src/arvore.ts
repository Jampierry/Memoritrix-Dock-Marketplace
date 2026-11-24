// Mapa mental: árvore de pastas e arquivos a partir das memórias da Sinapse, com layout radial. Lógica pura.

export interface NoArvore {
  chave: string // identificador estável (caminho da pasta ou id do arquivo)
  nome: string
  id?: string // id da memória, só nas folhas (arquivos)
  filhos: NoArvore[]
}
export interface ItemRadial { no: NoArvore; x: number; y: number; prof: number; pai?: { x: number; y: number }; recolhido: boolean }

/** Monta a árvore pela estrutura de pastas. Pastas com um único filho pasta se fundem ("a/b/c"), e o prefixo comum vira a raiz. */
export function montarArvore(nos: { id: string; titulo: string }[]): NoArvore {
  const partes = nos.map((n) => ({ n, seg: n.id.split('/').filter(Boolean) }))
  const base: string[] = []
  if (partes.length) {
    const menor = Math.min(...partes.map((p) => p.seg.length - 1)) // sem contar o nome do arquivo
    for (let i = 0; i < menor; i++) {
      const v = partes[0].seg[i]
      if (partes.every((p) => p.seg[i] === v)) base.push(v); else break
    }
  }
  const raiz: NoArvore = { chave: base.join('/'), nome: base[base.length - 1] ?? 'Memórias', filhos: [] }
  for (const { n, seg } of partes) {
    let atual = raiz
    const dirs = seg.slice(base.length, -1)
    dirs.forEach((d, i) => {
      const chave = [...base, ...dirs.slice(0, i + 1)].join('/')
      let f = atual.filhos.find((x) => x.chave === chave)
      if (!f) { f = { chave, nome: d, filhos: [] }; atual.filhos.push(f) }
      atual = f
    })
    atual.filhos.push({ chave: n.id, nome: n.titulo, id: n.id, filhos: [] })
  }
  const fundir = (no: NoArvore): NoArvore => {
    no.filhos = no.filhos.map(fundir)
    while (no.filhos.length === 1 && !no.filhos[0].id && no.filhos[0].filhos.length) {
      const f = no.filhos[0]
      no = { chave: f.chave, nome: `${no.nome}/${f.nome}`, filhos: f.filhos }
    }
    return no
  }
  const ordenar = (no: NoArvore): void => {
    no.filhos.sort((a, b) => Number(!!a.id) - Number(!!b.id) || a.nome.localeCompare(b.nome, 'pt-BR')) // pastas antes de arquivos
    no.filhos.forEach(ordenar)
  }
  const r = fundir(raiz)
  ordenar(r)
  return r
}

/** Folhas visíveis de um ramo (pasta recolhida conta como uma). */
function peso(no: NoArvore, aberto: Set<string>): number {
  if (!no.filhos.length || !aberto.has(no.chave)) return 1
  return no.filhos.reduce((s, f) => s + peso(f, aberto), 0)
}

/** Posições radiais: cada nível num anel, e cada ramo ocupa um setor proporcional às folhas visíveis. A raiz fica sempre aberta. */
export function layoutRadial(raiz: NoArvore, aberto: Set<string>, passo = 150): ItemRadial[] {
  const saida: ItemRadial[] = []
  const abertos = new Set(aberto).add(raiz.chave)
  const andar = (no: NoArvore, a0: number, a1: number, prof: number, pai?: { x: number; y: number }): void => {
    const ang = (a0 + a1) / 2
    const raio = prof * passo
    const pos = { x: Math.cos(ang) * raio, y: Math.sin(ang) * raio }
    const recolhido = no.filhos.length > 0 && !abertos.has(no.chave)
    saida.push({ no, ...pos, prof, pai, recolhido })
    if (!no.filhos.length || recolhido) return
    const total = no.filhos.reduce((s, f) => s + peso(f, abertos), 0)
    let a = a0
    for (const f of no.filhos) { const fa = ((a1 - a0) * peso(f, abertos)) / total; andar(f, a, a + fa, prof + 1, pos); a += fa }
  }
  andar(raiz, 0, Math.PI * 2, 0)
  return saida
}
