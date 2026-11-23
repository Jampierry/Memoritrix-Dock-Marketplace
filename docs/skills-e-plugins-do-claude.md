# Skills e plugins do Claude

Além dos módulos do Dock, este repositório mantém um **catálogo curado de skills e plugins públicos do Claude**. No app, ele aparece em **Ajustes > Skills e plugins do Claude**, com um botão para instalar no **Claude Code** ou no **projeto aberto no VS Code**.

## O que são

| | O que é | Como o app instala |
|---|---|---|
| **Skill** | Uma pasta com um `SKILL.md` (e arquivos de apoio) que ensina o Claude a fazer uma tarefa, como criar `.docx` ou revisar PDFs | Copia a pasta para `<.claude>/skills/<nome>/` |
| **Plugin** | Um pacote do Claude Code (comandos, agentes, hooks) publicado num *marketplace* de plugins | Liga o plugin no `settings.json`; o próprio Claude Code baixa na próxima vez que abrir |

## Onde instala

| Botão | Pasta | Vale para |
|---|---|---|
| **Instalar no Claude** | `~/.claude` (`C:\Users\<você>\.claude`) | O Claude Code do seu usuário, em qualquer pasta, inclusive o do VS Code |
| **Instalar no VS Code** | `<projeto>\.claude` | Só o projeto que você escolheu (a pasta aberta no VS Code) |

O Claude Code do VS Code lê as duas pastas. A diferença é o alcance: a do usuário vale sempre; a do projeto vale só ali e pode ser enviada junto com o repositório do projeto, para o time todo usar.

Na primeira vez que você clica em **Instalar no VS Code**, o app pede a pasta do projeto e lembra a escolha. Troque quando quiser em **Trocar pasta…**.

## Passo a passo

1. Abra **Ajustes > Skills e plugins do Claude**.
2. Procure pelo nome ou filtre por **Skills**, **Plugins** ou **Instalados**.
3. Leia a descrição, a origem (o repositório no GitHub) e a licença.
4. Clique em **Instalar no Claude** ou **Instalar no VS Code**.
5. A janela de confirmação mostra o que será instalado, **onde** e de **qual repositório e commit**. Só o seu **"Sim"** continua.
6. Abra uma conversa nova no Claude (skills) ou reinicie o Claude Code (plugins) para valer.

Para tirar, o mesmo botão vira **✓ … · Remover**.

## O que o app garante

- **Aprovado por quem mantém:** só aparecem itens do `claude-catalogo.json`, cada um com **assinatura Ed25519**. A assinatura cobre o tipo, o repositório, o commit e a pasta, então quem só consegue escrever neste repositório não consegue trocar a origem de um item.
- **Skills fixadas num commit:** o conteúdo baixado é sempre o mesmo, o que foi revisado. Se o autor mudar a skill depois, nada muda no seu computador até o catálogo apontar para outro commit.
- **Plugins acompanham o marketplace deles:** o Claude Code baixa a versão atual do marketplace de origem. A confirmação avisa isso.
- **Nada seu é apagado:** o app só remove o que ele mesmo instalou. Skills instaladas levam uma marca (`.memoritrix-origem.json`); se já existir uma skill sua com o mesmo nome, o app **para** e não mexe nela.
- **`settings.json` protegido:** antes da primeira alteração, o app guarda uma cópia (`settings.json.memoritrix.bak`). Se o arquivo estiver com um JSON inválido, o app **não toca nele**.
- **Sem comandos:** o app só copia arquivos e edita o `settings.json`. Não roda scripts nem instaladores.

> **Atenção:** skills e plugins são **instruções (e às vezes scripts) que o Claude segue com as suas permissões**. Instale só de fontes em que você confia. A aprovação deste catálogo não é uma auditoria do conteúdo: leia a origem e a licença.

## O catálogo atual

- **Skills** do repositório [anthropics/skills](https://github.com/anthropics/skills), fixadas no commit `e4bb5d9`: documentos Word, PDF, PowerPoint e Excel, design de interfaces, criador de skills, API do Claude, servidores MCP, testes de aplicativos web, entre outras.
- **Plugins** do marketplace [claude-code-plugins](https://github.com/anthropics/claude-code): revisão de código, desenvolvimento de funcionalidades, comandos de commit, segurança, hooks, entre outros.

A lista que vale é a do próprio app, que mostra o estado de cada item.

## Para quem mantém o catálogo

A fonte é o [`claude-catalogo.fonte.json`](../claude-catalogo.fonte.json). O app **não lê** esse arquivo: lê o `claude-catalogo.json`, gerado e assinado a partir dele.

1. Edite a fonte. Para uma skill nova, use o commit **de 40 caracteres** do repositório de origem (`git ls-remote <repo> HEAD`) e confira que `skills/<id>/SKILL.md` existe nele.
2. Assine, no clone do app:
   ```bash
   node scripts/assinar-catalogo-claude.mjs --destino <clone deste repositório>
   ```
3. Valide, sem abrir o app (baixa de verdade e instala todas as skills numa pasta de teste):
   ```bash
   MARKETPLACE_LOCAL=<clone> MARKETPLACE_ONLINE=1 npx vitest run tests/unit/modulo-claude.test.ts
   ```
4. Confira o `diff` e publique:
   ```bash
   git add claude-catalogo.json claude-catalogo.fonte.json
   git commit -m "claude: atualiza o catalogo de skills e plugins"
   git push origin main
   ```

| Campo (skill) | Regra |
|---|---|
| `repo` | `dono/nome` público no GitHub |
| `ref` | commit de **40 caracteres hexadecimais** (nunca uma branch) |
| `skills.itens[].id` | o nome da pasta da skill; vira `<.claude>/skills/<id>` |

| Campo (plugin) | Regra |
|---|---|
| `marketplace.nome` e `marketplace.repo` | o marketplace de plugins do Claude Code onde o plugin está |
| `plugins.itens[].plugin` | o nome do plugin dentro desse marketplace |

Mudar qualquer campo assinado à mão invalida a assinatura: o item some do app. Sempre reassine pelo script.

## Problemas comuns

| O que você vê | O que fazer |
|---|---|
| "O catálogo ainda não foi publicado" | O `claude-catalogo.json` não está na `main` deste repositório. |
| "Já existe uma skill … que não veio deste catálogo" | Há uma skill sua com o mesmo nome. Renomeie ou remova a sua e instale de novo. |
| "O … não é um JSON válido; não alterei nada" | O `settings.json` do Claude tem um erro de sintaxe. Corrija e tente de novo. |
| A skill instalada não aparece no Claude | Abra uma conversa nova. Para o projeto, confira que a pasta escolhida é a aberta no VS Code. |
| O plugin não carrega | Reinicie o Claude Code; ele baixa o plugin ao abrir. |
