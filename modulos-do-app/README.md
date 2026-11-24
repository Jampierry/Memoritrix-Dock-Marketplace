# Módulos que vêm no app

Estes três módulos **acompanham o Memoritrix Dock**: já estão dentro do app e **não se instalam por este marketplace**. As fontes ficam aqui como **referência** para estudar, copiar ideias e propor melhorias.

| Pasta | Módulo (id) | O que faz | Permissões |
|---|---|---|---|
| [`ia/`](ia) | **IA e Memorix** (`ia`) | Fila de provedores de IA com *fallback* pelo OmniRoute, chat do Memorix e dos assistentes, ferramentas, voz, componentes e **habilidades permanentes** (`skills_habil.md`) | `config`, `rede`, `ia`, `abrir-itens` |
| [`painel/`](painel) | **Painel e Sinapse** (`painel`) | A Sinapse: mapa do que o computador sabe (fontes locais, notas, grafo, mapa mental, MCP somente leitura) | `config`, `arquivos`, `ia` |
| [`claude/`](claude) | **Skills e plugins do Claude** (`claude`) | Catálogo curado de skills e plugins públicos do Claude e instalação no Claude Code e no VS Code; instalador do Graphify | `rede`, `arquivos`, `config` |

Os três podem ser **ligados e desligados** em **Ajustes > Sistema** do app. Desligados, o Dock continua funcionando sozinho.

## Por que não instalam daqui

- Os ids `ia`, `painel` e `claude` são **reservados**: o app recusa qualquer módulo do catálogo com esses ids, para que ninguém possa trocar um módulo do app por outro.
- Eles usam **partes internas do app** (Electron, as janelas, a confirmação de ações, os tipos compartilhados) e não são um arquivo único empacotado, como o marketplace exige.

Para criar um módulo **instalável**, comece pelo [`exemplos/ola-dock`](../exemplos/ola-dock) e leia [Criar um módulo](../docs/criar-um-modulo.md).

## Canais e serviços de cada módulo

A interface só chega a um módulo por canais IPC registrados com `ctx.ipc.tratar` (e só enquanto o módulo está ativo). Outros módulos usam os **serviços** (`ctx.servicos`).

**`ia`**
- Canais: `ia:memorix-chat`, `ia:memorix-historico`, `ia:memorix-limpar`, `ia:memoria-listar`, `ia:memoria-esquecer`, `ia:habilidades-listar`, `ia:habilidades-esquecer`, `ia:agir-config`, `ia:agir-permitir`, `ia:imagem-acao`, `ia:imagem-buscar`, `ia:voz-estado`, `ia:voz-instalar`, `ia:voz-salvar`, `ia:voz-transcrever`, `ia:componentes-estado`, `ia:componentes-instalar`, `ia:componentes-progresso`
- Serviço: `ia.perguntar`
- Ferramentas dos assistentes (quando "IA pode agir no app" está ligado): abrir atalhos, buscar na web, ler e criar notas na Sinapse, **consultar e criar o mapa de um projeto (Graphify)** e ações sensíveis que sempre pedem o seu **Sim**.

**`painel`**
- Canais: `painel:fontes`, `painel:fonte-adicionar`, `painel:fonte-ativar`, `painel:fonte-remover`, `painel:aprender`, `painel:atualizado`, `painel:buscar`, `painel:grafo`, `painel:perguntar`, `painel:resumir`, `painel:nota-salvar`, `painel:vigia`, `painel:vigia-definir`, `painel:ia-config`, `painel:ia-permitir`, `painel:mcp-config`, `painel:mcp-ligar`
- Serviços: `painel.buscar`, `painel.criarNota`, `painel.escreverArquivo`

**`claude`**
- Canais: `claude:catalogo`, `claude:instalar`, `claude:remover`, `claude:escolherProjeto`, `claude:graphify-estado`, `claude:graphify-instalar`

## Como ler o código

- `module.json`: o manifesto (id, permissões, versão mínima do Dock).
- `src/index.ts`: o ponto de entrada. Exporta `codigo` com `ativar(ctx)` e `desativar()`, como qualquer módulo.
- As fontes importam tipos de `@shared/…` e `@memoritrix/nucleo-modulos`, que vivem no repositório do app. Por isso **este código não compila sozinho**; ele é uma cópia para leitura.

> As fontes aqui são um **espelho**: a versão que vale é a do app. Se houver diferença, o app manda.
