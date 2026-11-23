# Criar um módulo

Guia de quem **desenvolve**. Para publicar o resultado aqui, siga depois [Publicar no marketplace](publicar.md).

## Anatomia

Um módulo é uma pasta com dois arquivos, no mínimo:

```
meu-modulo/
├─ module.json      o manifesto
└─ index.cjs        a entrada, já empacotada em um único arquivo (.js ou .cjs)
```

O módulo precisa vir **já empacotado**: um único arquivo de entrada, sem `node_modules`. Use `esbuild` ou parecido se o seu código tiver dependências.

Um exemplo pronto para copiar está em [`exemplos/ola-dock`](../exemplos/ola-dock).

## `module.json`

```json
{
  "id": "meu-modulo",
  "nome": "Meu módulo",
  "versao": "1.0.0",
  "descricao": "O que ele faz, em uma frase.",
  "entrada": "index.cjs",
  "permissoes": ["config", "rede"],
  "dockMinima": "0.1.0"
}
```

| Campo | Regra |
|---|---|
| `id` | minúsculas, números e hífen; começa com letra; até 32 caracteres. `ia` e `painel` são do app e **não podem ser usados** |
| `nome`, `descricao` | texto livre; aparecem na aba **Disponíveis** |
| `versao`, `dockMinima` | `x.y.z` (semver). `dockMinima` é a menor versão do Dock em que o módulo funciona |
| `entrada` | caminho **relativo** dentro da pasta, terminando em `.js` ou `.cjs` (sem `..` nem caminho absoluto) |
| `permissoes` | lista com valores de `rede`, `arquivos`, `abrir-itens`, `ia`, `config`, `janelas`, `notificacoes` |

O Dock recusa o módulo se o manifesto for inválido, se o id já existir ou se o Dock for mais antigo que `dockMinima`.

### O que cada permissão significa para quem instala

| Permissão | Como o app descreve |
|---|---|
| `rede` | internet |
| `arquivos` | arquivos |
| `abrir-itens` | abrir programas e pastas |
| `ia` | IA do Memorix |
| `config` | dados no app (necessária para canais IPC e para guardar dados) |
| `janelas` | janelas |
| `notificacoes` | avisos |

Peça **só o que precisa**. Quem instala lê essa lista antes de dizer "Sim".

## O código

O arquivo de entrada exporta **`codigo`**: um objeto com `ativar(ctx)` e, se quiser, `desativar()`.

```js
// index.cjs
exports.codigo = {
  ativar(ctx) {
    ctx.ipc.tratar('meu-modulo:ola', () => ({ ok: true, dados: 'olá' }))
  },
  desativar() {}
}
```

> Exportar o objeto direto em `module.exports` **não funciona**: o app procura `codigo`.

### O `ctx`

| API | Para quê |
|---|---|
| `ctx.manifesto` | O seu próprio manifesto |
| `ctx.tem(permissao)` | Se o módulo declarou a permissão |
| `ctx.dados.lerJson(nome, padrao)` / `gravarJson(nome, dados)` | Guardar dados do usuário em JSON (escrita atômica) |
| `ctx.ipc.tratar(canal, fn)` | Canal IPC para a interface. O nome começa com `"<id>:"` e exige a permissão `config` |
| `ctx.servicos.registrar(nome, impl)` / `obter(nome)` | Serviços que outros módulos podem usar. Ex.: `ia.perguntar`, `painel.buscar`, `painel.criarNota` |
| `ctx.eventos.emitir(topico, dados)` / `ouvir(topico, fn)` | Barramento de eventos entre módulos |
| `ctx.dock.registrarItem(item)` / `ctx.painel.registrarTela(tela)` | Acrescentar itens à dock e telas ao painel |

**Tudo o que o módulo registra é desfeito sozinho quando ele é desativado.** Por isso `desativar()` quase nunca precisa fazer nada.

### Boas práticas

- Nomeie canais e serviços com o prefixo do seu id (`meu-modulo:…`, `meu-modulo.…`), para nunca colidir com outro módulo.
- Trate erros e devolva `{ ok: false, erro: '…' }` em vez de lançar exceções para a interface.
- Não guarde segredos em texto puro nos dados do módulo.
- Escreva em `ctx.dados` só o que o usuário espera ver guardado.

## Testar antes de publicar

1. Crie a pasta com `module.json` e a entrada.
2. Empacote e assine com [`scripts/publicar-modulo.mjs`](publicar.md) **sem enviar nada**: ele só gera o `.zip` e o catálogo numa pasta local de teste.
3. Valide o manifesto: o script recusa `id`, versões, permissões e `entrada` inválidos e diz qual campo está errado.

## Limites atuais

- As permissões **não são uma sandbox**: descrevem o que o módulo diz que faz.
- O módulo precisa vir **empacotado** num único `.js`/`.cjs`.
- O app lê **só este repositório**: não há como apontar para outro catálogo.
