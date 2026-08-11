# PSM Analytics Pro 2.13.3

## Alteração 2.13.3

- Somente na tabela da aba **Ordens**, “Mão de obra” foi abreviado para **M.O.**.
- A coluna **M.O.** ficou mais estreita e passou a aparecer antes de **Duração**.
- Os formulários de adicionar e editar atividades não foram modificados.

## Correção 2.13.2

- Dashboard ajustado para a largura real do celular, sem cortar títulos, filtros ou cartões.
- Filtros usam duas colunas em tablets e uma coluna nos celulares, evitando textos e botões cortados.
- Textos dos indicadores quebram de linha dentro dos próprios cartões.
- O menu continua rolável horizontalmente, sem ampliar a largura da página inteira.

## Correção 2.13.1

- No modo **Visualizar**, as ATAs permanecem bloqueadas para edição, mas conservam as mesmas cores, cabeçalhos e destaques usados no modo **Apresentação**.
- Os menus de presença e status continuam visíveis com suas cores originais, sem permitir alterações.

## Tela inicial e modos de acesso

- O sistema abre com o título do projeto e as opções `VISUALIZAR` e `APRESENTAÇÃO`.
- `VISUALIZAR` mantém disponíveis os filtros e a edição da Programação diária.
- No PSM, o modo Visualizar mostra Dashboard, Ordens, Programação diária, Quadro QPP, ATA 1 e ATA 2.
- Na aba Ordens do modo Visualizar aparecem somente atividades classificadas como `QPP` ou `Rotina`.
- No PROMAN, o modo Visualizar mostra Painel, Backlog, ATA 1 e ATA 2.
- Ordens, Quadro QPP, atas e Backlog PROMAN ficam protegidos contra edição no modo Visualizar.
- `APRESENTAÇÃO` preserva todas as funções atuais, inclusive cadastros, importações, edições, salvamento e exportações.
- O botão `TROCAR ACESSO` permite voltar à tela inicial sem apagar os dados.

## Semana atual no cabeçalho

- O cabeçalho do Dashboard e do Backlog mostra automaticamente a semana corrente.
- O período exibido considera a segunda-feira e a sexta-feira da semana atual.
- A seleção e a navegação do Quadro QPP continuam independentes.

## Pesquisa sem travamentos

- O campo `PESQUISAR` não reconstrói mais o dashboard e os gráficos a cada letra digitada.
- A filtragem é aplicada automaticamente após uma pausa curta na digitação.
- A tecla `Enter` aplica a pesquisa imediatamente.
- A colagem de várias ordens continua funcionando e aplica o resultado sem atraso.
- As pesquisas do Painel PROMAN e do Backlog PROMAN receberam a mesma otimização.

## Todas as importações no Backlog PROMAN

- Todas as atividades importadas das planilhas PROMAN entram no Backlog PROMAN, independentemente do status.
- Atividades concluídas, canceladas, sem status e com outros status também permanecem disponíveis no backlog.
- Os filtros do backlog continuam permitindo selecionar os status desejados.
- Na Programação diária, o rótulo `UNIDADE PROMAN` foi simplificado para `PROMAN`.

## Ordem do menu PROMAN

- A opção `IMPORTAÇÕES` foi movida para imediatamente abaixo de `NOVA ATIVIDADE`.
- A ordem inicial do menu agora é `PAINEL PROMAN`, `BACKLOG PROMAN`, `NOVA ATIVIDADE` e `IMPORTAÇÕES`.
- Nenhuma função das telas foi alterada.

## Rolagem no modo de apresentação

- As colunas `QPP`, `ROTINA` e `REALIZADO` agora possuem rolagem vertical independente no modo TV.
- A rolagem funciona com roda do mouse, touchpad e gesto vertical em tela sensível ao toque.
- A barra de rolagem fica visível para indicar quando existem outras atividades abaixo.
- Cabeçalho do dia, áreas e títulos das colunas permanecem fixos enquanto as atividades são percorridas.

## Filtro PROMAN na Programação diária

- A Programação diária agora possui filtro múltiplo exclusivo para `BRITAGEM` e `FÁBRICA`.
- O filtro atua somente sobre as atividades PROMAN.
- Atividades QPP e Rotina da Reunião PSM não são ocultadas ou alteradas por essa seleção.
- Sem seleção, as duas unidades PROMAN são exibidas; também é possível selecionar uma ou ambas.
- A seleção fica salva no navegador e no arquivo `.psm`.

## Programação diária PROMAN

- Toda atividade PROMAN aberta aparece em qualquer dia e em qualquer semana selecionada na Programação diária.
- A data original da planilha permanece registrada, mas não limita em quais dias a atividade é exibida.
- A atividade deixa de aparecer somente quando receber status `CONCLUÍDA` ou `CANCELADA`.
- O comportamento vale para atividades importadas e cadastradas manualmente na PROMAN.
- O filtro de Área foi removido da Programação diária.
- Permanecem disponíveis os filtros de Semana, Dia da semana e Oficina.

## PROMAN na Programação diária

- Todas as atividades PROMAN abertas aparecem automaticamente na Programação diária.
- Atividades concluídas ou canceladas não são exibidas na Programação diária.
- A atividade permanece vinculada ao dia informado na planilha e mantém os indicadores PROMAN e de tipo de atividade.

## Importações e Backlog PROMAN

- Foi criada uma aba exclusiva de Importações no ambiente PROMAN, com áreas separadas para Britagem e Fábrica.
- Os controles de importação, exportação e limpeza foram removidos do Painel PROMAN e centralizados nessa nova aba.
- Registros importados e atividades manuais passam a compor o Backlog PROMAN sem duplicação.
- O Backlog exibe todas as atividades importadas e cadastradas manualmente, independentemente do status.
- Registros concluídos, cancelados ou sem status continuam disponíveis no Painel PROMAN e também no Backlog.
- Os filtros de Status e Ano do painel e os filtros de Unidade, Status e Tipo do backlog agora permitem seleção múltipla.

## Cores no Quadro QPP e no Histórico

- O cabeçalho de controles do Quadro QPP agora utiliza fundo azul, faixa verde e textos brancos.
- O cabeçalho do Histórico de alterações recebeu o mesmo padrão corporativo.
- Botões e seleção de semanas permanecem funcionais e responsivos.

## Cabeçalho do Dashboard

- A linha com semana, período e “visão consolidada de ordens” foi removida somente da aba Dashboard.
- Na aba Ordens/Backlog, a semana e o período continuam visíveis.

## Títulos do Dashboard e do Backlog

- O cabeçalho corporativo azul com faixa verde agora aparece na aba Dashboard e na aba Ordens.
- Na aba Dashboard, o título exibido é `DASHBOARD PSM`.
- Na aba Ordens, o título exibido é `BACKLOG`.
- A semana e o período permanecem visíveis nos dois cabeçalhos.

## Cores corporativas no cabeçalho da aba Ordens

- O cabeçalho superior existente da aba Ordens recebeu fundo azul, faixa verde e textos brancos, seguindo o padrão visual do Backlog PROMAN.
- A semana e o período de segunda a sexta continuam visíveis no mesmo cabeçalho.
- A faixa adicional criada dentro da aba Ordens foi removida.

## Logo Votorantim Cimentos

- A marca `PCM` da barra lateral foi substituída pela logo oficial enviada.
- A logo foi adicionada ao lado esquerdo do cabeçalho do Quadro QPP.
- A logo foi adicionada aos cabeçalhos de todas as atas PSM e PROMAN.
- Foram aplicados tamanhos responsivos para notebook, TV, celular, impressão e relatório PDF.

## Padronização Salvar PSM e Abrir PSM

- Todos os botões antes chamados `Salvar projeto` agora exibem `Salvar PSM`.
- Todos os botões antes chamados `Abrir projeto` agora exibem `Abrir PSM`.
- Mensagens de confirmação, histórico e avisos também utilizam a nomenclatura PSM.

## Abrir PSM na Programação diária

- A aba `Programação diária` possui o botão `Abrir PSM` no próprio cabeçalho.
- O botão utiliza o mesmo carregamento seguro de arquivos `.psm` já existente no sistema.
- Após a confirmação, ordens, HH disponível, programação, Quadro QPP, atas, histórico e dados PROMAN são restaurados normalmente.

## Barra de ações do Backlog PROMAN

- O cabeçalho do Backlog PROMAN possui `Salvar PSM`, `Abrir PSM`, `Exportar Excel`, tema, tela cheia e `Nova atividade`.
- A exportação gera uma planilha com as atividades exibidas no backlog, respeitando os filtros de unidade, pesquisa, status e tipo.
- O botão de salvamento foi movido da barra lateral para o cabeçalho do Backlog PROMAN.

## Atas PROMAN

- No menu da Reunião PROMAN, as atas foram renomeadas para `ATA 1` e `ATA 2`.
- A ATA 1 usa a lista de participantes da Fábrica e a ATA 2 usa a lista da Britagem.
- Os vistos `OK`, `NOK`, `FÉRIAS` e `ATRASADO` mantêm as cores e atualizam automaticamente a participação.
- Foram adicionados os blocos `Ações de Segurança e Meio Ambiente`, `Ações Resolvidas das Reuniões Anteriores` e `Ações Pendentes das Reuniões Anteriores`.
- Cada bloco permite adicionar novas linhas e editar TAG, ação, responsável, data, situação e comentário.
- Todas as linhas adicionais permanecem no salvamento local e no arquivo de projeto `.psm`.

## Integração PROMAN com a reunião semanal

- `Backlog PROMAN` foi movido para cima de `Nova atividade` na barra lateral.
- A fonte das linhas, rótulos e ações do Backlog PROMAN foi ampliada.
- Foram criadas atas PROMAN independentes para `Fábrica` e `Britagem`, totalmente editáveis e salvas no projeto.
- As atividades PROMAN entram automaticamente na coluna `Rotina` da Programação diária conforme sua data.
- Cada atividade recebe o indicador laranja `PROMAN`.
- Atividades do tipo `SEGURANÇA` ou `OPORTUNIDADE` recebem também seu indicador específico.
- O check-in da Programação diária atualiza a própria atividade PROMAN e permanece salvo.

## Ajustes do cadastro PROMAN

- O filtro conjunto de unidades agora exibe apenas `TODAS`.
- O prazo pode ser alterado normalmente no cadastro e na edição.
- Ações não concluídas ou canceladas passam automaticamente para `ATRASADA` quando o prazo vence.
- Ao prorrogar uma ação atrasada para uma data futura, o status retorna para `NO PRAZO`.
- Novo tipo de atividade: `SEGURANÇA`, `OPORTUNIDADE`, `CORRETIVA` ou `NÃO`.
- O tipo aparece no Painel PROMAN, no backlog, nos filtros e na exportação para Excel.

## Cadastro e backlog PROMAN

- A Reunião PROMAN agora possui as opções `Nova atividade` e `Backlog PROMAN` na barra lateral.
- O cadastro inclui unidade, data, TAG, atividade, responsável, prazo, status, Nota/OS e observações.
- As atividades adicionadas entram automaticamente no Painel PROMAN e permanecem salvas no navegador e no arquivo `.psm`.
- O backlog manual permite pesquisar, filtrar por unidade e status, editar e excluir atividades.
- Uma nova importação da planilha PROMAN preserva as atividades cadastradas manualmente.

## Ajuste do menu lateral

- `Enviar por e-mail` agora usa o mesmo visual azul das demais opções do menu.
- O verde aparece somente quando uma aba navegável está selecionada.
- A opção foi posicionada imediatamente acima de `Histórico`.

## Proteção contra recarga acidental

- Atualizar a página, fechar a aba ou sair do sistema exibe uma confirmação do navegador.
- Escolher cancelar mantém a reunião aberta exatamente na tela atual.
- Escolher continuar permite atualizar ou fechar normalmente.

## Correção do PDF

- Os gráficos são preparados fora da tela antes da captura, mesmo quando o relatório é enviado a partir da ATA, do Quadro QPP ou de outra aba.
- O PDF não repete o cabeçalho interno das páginas, deixando a apresentação mais limpa.
- A data do Quadro QPP aparece apenas uma vez em cada dia.
- Depois da geração, a aba e os filtros que estavam em uso permanecem inalterados.

## Impressão e envio do relatório completo

- A impressão da ATA 1 e da ATA 2 agora exibe corretamente a ata selecionada.
- O menu lateral possui o botão `Enviar por e-mail`.
- O relatório PDF reúne Dashboard completo, Programação diária QPP/Rotina, semanas selecionadas do Quadro QPP, ATA 1 e ATA 2.
- O sistema baixa um rascunho `.eml` compatível com Outlook, já contendo o PDF anexado. Basta abrir o rascunho, informar os destinatários e clicar em Enviar.

## Campo de pesquisa simplificado

- O campo agora exibe somente `Pesquisar`.
- A colagem e a pesquisa de várias ordens continuam funcionando normalmente.

## Pesquisa mÃºltipla de ordens

- Copie uma coluna de ordens do Excel e cole diretamente no campo de pesquisa.
- TambÃ©m sÃ£o aceitas ordens separadas por vÃ­rgula, ponto e vÃ­rgula, tabulaÃ§Ã£o ou espaÃ§o.
- A tabela exibe todas as ordens encontradas em uma Ãºnica pesquisa.
- Um contador ao lado do campo confirma quantos termos foram reconhecidos.
- A pesquisa continua combinada com Ã¡rea, oficina, classificaÃ§Ã£o, criticidade e os demais filtros ativos.
- Limpar somente o texto da pesquisa nÃ£o remove os outros filtros.

## Custo consolidado por área

- A linha CUSTO apresenta o total de QPP + Rotina de cada área.
- O custo por área não é alterado pelo filtro de oficina.
- O Custo Total também permanece consolidado e independente da oficina.

## Custo por área no consumo de HH

- O miniquadro de consumo agora mostra o custo de QPP + Rotina em cada área.
- A linha de custo por área permanece consolidada ao selecionar uma oficina.
- O Custo Total permanece consolidado e não é alterado pelo filtro de oficina.

## Numeração e preenchimento de observações

- A tabela de ordens agora mostra uma numeração sequencial e fixa na lateral esquerda.
- A coluna Observação possui uma alça verde para copiar o texto por arraste.
- O preenchimento respeita a ordem, os filtros e a página atualmente exibida.
- As alterações são salvas e registradas no histórico.

## Preenchimento QPP por arraste

- A coluna `QPP` agora possui uma pequena alça verde em cada linha.
- Selecione `Não`, `Rotina`, `QPP`, `PRIOR`, `EXEC` ou `REPR` na primeira ordem e arraste a alça para cima ou para baixo.
- Todas as ordens atravessadas recebem a mesma classificação, como no preenchimento do Excel.
- As linhas do intervalo ficam destacadas durante o arraste.
- A alteração em lote é salva automaticamente e registrada uma única vez no Histórico.

## Reunião PROMAN

- A barra lateral agora separa `REUNIÃO PSM` e `REUNIÃO PROMAN`.
- A Reunião PSM preserva integralmente o dashboard, ordens, importações, programação diária, Quadro QPP, ATAs e histórico.
- A Reunião PROMAN possui abas internas independentes para `BRITAGEM` e `FÁBRICA`.
- Cada aba importa sua própria planilha Excel e identifica automaticamente as colunas `DATA`, `TAG`, `O QUE`, `QUEM`, `PRAZO`, `STATUS`, `NOTA/OS` e `OBSERVAÇÕES`.
- Indicadores: total de ações, concluídas, em aberto, atrasadas e ações com Nota/OS.
- Gráficos: distribuição por status, evolução mensal, responsáveis com mais ações e concentração por prefixo da TAG.
- Pesquisa, filtros por status e ano, tabela paginada e exportação da base PROMAN filtrada.
- As bases PROMAN ficam salvas no navegador e também são incluídas no arquivo de projeto `.psm`.

- O cabeçalho "Dashboard PSM / Semana" foi removido somente da aba Dashboard.
- Os rótulos do Pareto foram separados: custo dentro da barra e percentual abaixo do ponto da linha.
- Os textos auxiliares foram removidos da Programação Diária e do Quadro QPP.
- O botão de fixar a barra lateral foi reposicionado e aparece somente após a expansão completa.
- O nome "Planejamento semanal" agora possui espaço reservado e não fica coberto pelo botão de fixar.

- O campo "Data de realização" das ATAs foi reduzido e alinhado ao rótulo, eliminando a sobreposição.
- Em telas muito estreitas, o rótulo e a data passam automaticamente para duas linhas organizadas.

- Os campos editáveis das ATAs preservam maiúsculas e minúsculas exatamente como digitadas.
- Os campos de observação das ordens, atividades, programação diária e Quadro QPP não convertem mais o texto para maiúsculas.
- O título editável da ATA agora quebra em até duas linhas, evitando cortes em telas menores.

## Novidades desta versão

- O comando `LIMPAR BANCO DE ORDENS` foi movido da aba ORDENS para a aba IMPORTAÇÕES.
- O comando agora aparece ao lado de `IMPORTAR COMPLEMENTARES` no mesmo cartão.
- Nova aba `IMPORTAÇÕES` abaixo de `HH DISPONÍVEL` no menu lateral.
- Os comandos de importação de COMPLEMENTARES e SISTEMÁTICAS foram movidos para essa nova tela.
- Adicionado o comando `LIMPAR BANCO DE SISTEMÁTICAS`, preservando as ordens já inseridas no backlog.
- Toda a interface passa a utilizar letras maiúsculas como padrão visual.
- Os gráficos agora exibem rótulos com os valores diretamente sobre barras, linhas e segmentos.
- O modo TV foi compactado para exibir mais atividades simultaneamente em cada coluna.
- Cartões, espaçamentos, cabeçalhos e observações ficaram menores somente durante a apresentação em tela cheia.
- Novo botão `Apresentar na TV` na Programação diária.
- O modo TV oculta menus, filtros e cabeçalhos gerais e faz o quadro ocupar toda a tela.
- Com um dia selecionado, QPP, Rotina e Realizado utilizam toda a largura da TV em três colunas.
- O modo TV amplia automaticamente os textos e possui um botão discreto para sair, além da tecla `Esc`.
- Na Programação diária, a coluna `Rotina` mostra somente ordens `NÃO SISTEMÁTICA`.
- Ordens `SISTEMÁTICA` classificadas como `QPP` continuam aparecendo normalmente na coluna QPP.
- O check-in foi reduzido para uma caixa compacta ao lado da classificação da atividade.
- A observação da Programação diária agora é independente da observação da aba Ordens, aceita espaços normalmente e fica salva por semana, dia e atividade.
- O cabeçalho `Dashboard PSM` e o período da semana aparecem somente nas abas `Dashboard` e `Ordens`.
- As telas operacionais passam a começar diretamente pelo seu próprio conteúdo, ampliando a área útil.
- A faixa com importações, salvamento, abertura, exportação, tema e tela cheia aparece somente na aba `Ordens`.
- Nas demais telas permanecem apenas o título e o período da semana.
- A coluna visual `Tipo` foi ocultada do detalhamento das ordens.
- O tipo permanece ativo internamente, no filtro, no cadastro, no arquivo `.psm` e na exportação Excel.
- Importação separada do arquivo `SISTEMÁTICAS.xlsb`, usando a aba `BASE SIST`.
- As ordens sistemáticas ficam em um catálogo de consulta e não entram automaticamente no Backlog.
- Inclusão em massa de ordens sistemáticas por número de OS.
- Ordens encontradas entram no Backlog como `Rotina`, mantendo a classificação editável.
- Ordens não encontradas podem ser cadastradas manualmente com o número já preenchido.
- Novo tipo de ordem:
  - `NÃO SISTEMÁTICA` para ordens da planilha COMPLEMENTARES.
  - `SISTEMÁTICA` para ordens recuperadas do catálogo SISTEMÁTICAS.
- Novo filtro múltiplo por tipo de ordem.
- Nova coluna `Tipo` na tabela de ordens.
- Exportação Excel inclui o tipo e a origem técnica de cada ordem.
- A limpeza do campo de pesquisa não remove os demais filtros aplicados.
- Catálogo SISTEMÁTICAS, metadados e tipos ficam salvos no navegador e no arquivo `.psm`.

## Como usar as SISTEMÁTICAS

1. Clique em **Carregar SISTEMÁTICAS** e escolha o arquivo `SISTEMÁTICAS.xlsb`.
2. O sistema carrega o catálogo sem alterar o Backlog.
3. Na aba **Ordens**, clique em **Ordens em massa**.
4. Cole os números das ordens, um por linha ou separados por espaço, vírgula ou ponto e vírgula.
5. Clique em **Buscar e adicionar**.
6. As ordens encontradas entram no Backlog como `Rotina` e `SISTEMÁTICA`.
7. Para uma ordem não encontrada, clique em **Cadastrar manualmente**.

## Importação da COMPLEMENTARES

- Clique em **Importar COMPLEMENTARES**.
- Selecione o arquivo que contém a aba `PAINEL COMP`.
- As ordens dessa base entram normalmente no Backlog como `NÃO SISTEMÁTICA`.
- Ordens sistemáticas e atividades cadastradas manualmente são preservadas.

## Salvamento e exportação

- **Salvar PSM** cria um arquivo `.psm` com ordens, catálogo SISTEMÁTICAS, HH disponível, Quadro QPP, atas, histórico e filtros.
- **Abrir PSM** restaura todos esses dados.
- **Exportar Excel** exporta as ordens filtradas e inclui as colunas `Tipo` e `Origem técnica`.

## Execução

O projeto pode ser aberto diretamente pelo `index.html` no navegador. Para desenvolvimento no VS Code, também pode ser usado com Live Server.
