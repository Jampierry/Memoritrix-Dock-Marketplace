# Publicar no marketplace

Guia do **mantenedor**: quem tem a chave de assinatura e envia módulos para este repositório. Quem só quer propor um módulo abre uma *issue* e segue o [Criar um módulo](criar-um-modulo.md).

Os scripts abaixo ficam no repositório do app ([Memoritrix---Dock](https://github.com/Jampierry/Memoritrix---Dock), pasta `scripts/`). Você precisa de Node.js e de um clone deste repositório.

## Visão geral

```
pasta do módulo ──► publicar-modulo.mjs ──► pacotes/<id>-<versão>.zip   (+ SHA-256)
                                       └──► marketplace.json atualizado (+ assinatura Ed25519)
                                                      │
                                      git add / commit / push  (main)
                                                      ▼
                          o app lê marketplace.json e baixa o pacote de pacotes/
```

## 1. Gere o par de chaves (uma vez)

```bash
node scripts/gerar-chave-assinatura.mjs
```

- A chave **privada** fica em `~/.memoritrix/assinatura-privada.pem`, **fora de qualquer repositório**. Ela **nunca** vai ao GitHub.
- **Guarde uma cópia segura.** Quem tiver a chave privada assina módulos que o app aceita.
- A chave **pública** é impressa na tela. Ela já vem dentro do app (`packages/marketplace/src/assinatura.ts`). Trocá-la exige uma nova versão do app, e módulos assinados com a chave antiga deixam de ser aceitos.

## 2. Empacote e assine

Dentro do clone do app:

```bash
node scripts/publicar-modulo.mjs <pasta-do-modulo> --destino <pasta do clone deste repositório>
```

Opções:

| Opção | Para quê |
|---|---|
| `--destino <pasta>` | Onde está o clone do marketplace (grava em `<pasta>/pacotes/` e atualiza `<pasta>/marketplace.json`) |
| `--repo dono/repositorio` | Outro repositório (o padrão é `Jampierry/Memoritrix-Dock-Marketplace`) |
| `--chave <arquivo.pem>` | Outra chave privada (o padrão é `~/.memoritrix/assinatura-privada.pem`) |
| `--release` | Põe o pacote nas Releases do GitHub em vez de na pasta `pacotes/` |
| `--saida <pasta>` | Com `--release`, onde gerar o `.zip` |
| `--catalogo <arquivo>` | Outro `marketplace.json` |

O script:

1. **Valida o manifesto**: `id`, `nome`, `descricao`, `versao`, `dockMinima`, `entrada` e `permissoes`. Diz qual campo está errado.
2. Gera o `.zip` (sempre **idêntico** para o mesmo conteúdo) e calcula o **SHA-256**.
3. **Assina** a entrada: `id`, `versao`, `sha256` e o endereço do pacote.
4. Atualiza o `marketplace.json` (a entrada do mesmo `id` é substituída, e a lista fica em ordem alfabética).
5. **Mostra os comandos de `git`** para publicar. **Ele não envia nada para a internet.**

## 3. Revise e publique

Antes do `git push`, confira:

- O `diff` do `marketplace.json` só mexe na entrada do módulo.
- O `.zip` novo está em `pacotes/` e o nome é `<id>-<versão>.zip`.
- A `versao` é **maior** que a anterior (o app só oferece atualização quando a versão sobe).

Depois:

```bash
cd <clone do marketplace>
git add marketplace.json pacotes
git commit -m "marketplace: <id> <versão>"
git push origin main
```

Em poucos minutos o módulo aparece em **Ajustes > Módulos > Disponíveis** (o app guarda o catálogo por um tempo; **Atualizar lista** força a consulta).

## 4. Confira no app

1. Abra **Ajustes > Módulos > Disponíveis** e clique em **Atualizar lista**.
2. O módulo precisa aparecer **sem** o aviso de "itens ignorados". Se aparecer, a entrada falhou na validação (veja [Catálogo e segurança](catalogo-e-seguranca.md#por-que-uma-entrada-é-ignorada)).
3. Instale, confirme e teste.

## Atualizar um módulo

Suba a `versao` no `module.json`, rode o `publicar-modulo.mjs` de novo e envie. Quem já tem o módulo vê a aba **Atualizações**, e o app guarda a versão anterior para **Voltar**.

## Retirar um módulo

Apague a entrada do `marketplace.json` e envie. O módulo some de **Disponíveis**; quem já o instalou continua com ele até desinstalar. Se o módulo for perigoso, avise quem o instalou: o marketplace não consegue removê-lo dos computadores.

## Lista de conferência

- [ ] `id` novo, em minúsculas, e não é `ia` nem `painel`
- [ ] Permissões: só as necessárias
- [ ] `dockMinima` é a versão mais antiga em que o módulo foi testado
- [ ] Empacotado em um arquivo único
- [ ] Rodei o script, o SHA-256 saiu e a entrada foi assinada
- [ ] O `diff` do catálogo mexe só na entrada certa
- [ ] A chave privada **não** está em nenhuma pasta de repositório
