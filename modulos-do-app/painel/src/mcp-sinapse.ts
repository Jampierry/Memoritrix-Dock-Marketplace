import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import type { NotaIndexada } from './indexador'
import { tratarMcp } from './mcp'
import { lerTrecho } from './resumos'

// Programa do servidor MCP da Sinapse (stdio). A dock gera o comando para colar na IA; ele roda com o executável do app em modo Node
// (ELECTRON_RUN_AS_NODE=1) e lê só os arquivos de dados do dock, apontados por SINAPSE_DADOS. Nada de rede.
const dados = process.env['SINAPSE_DADOS'] ?? ''
const ler = <T>(nome: string, padrao: T): T => { try { return JSON.parse(readFileSync(join(dados, nome), 'utf-8')) as T } catch { return padrao } }

const deps = {
  ligado: (): boolean => ler<{ ligado?: boolean }>('painel-mcp.json', {}).ligado === true, // checado a cada chamada: desligar na dock vale na hora
  notas: (): NotaIndexada[] => ler<{ notas?: NotaIndexada[] }>('painel-indice.json', {}).notas ?? [],
  trecho: lerTrecho
}

if (!dados) { process.stderr.write('Defina SINAPSE_DADOS com a pasta de dados do Memoritrix Dock.\n'); process.exit(2) }
const linhas = createInterface({ input: process.stdin })
linhas.on('line', (linha) => {
  if (!linha.trim()) return
  let req
  try { req = JSON.parse(linha) } catch { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON inválido' } }) + '\n'); return }
  const r = tratarMcp(req, deps)
  if (r) process.stdout.write(JSON.stringify(r) + '\n')
})
linhas.on('close', () => process.exit(0))
