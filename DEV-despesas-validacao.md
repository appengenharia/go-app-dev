# Tipo de despesa — entrega exclusiva no GO-dev

## Escopo

- Lançamentos e Relatórios: Todas (padrão), Reembolsáveis e Empresa.
- Compatibilidade: `reembolsavel` verdadeiro continua Reembolsável; falso, nulo ou ausente continua Empresa. Nenhuma migração ou gravação em despesas.
- Filtros combinados de obra, período e colaborador (onde disponível), limitados às obras do perfil. Lançamentos inclui filtro de mês.
- Listagem inclui documentos sem `criadoEm`, respeita múltiplas obras e impede respostas antigas de sobrescrever a consulta mais recente.
- Seleção e resumo compartilhados entre prévia, PDF para download e PDF/corpo/comprovantes do e-mail. Fechamento mensal chama o mesmo fluxo de envio.
- Todas apresenta subtotais das duas classes e total geral. Uma classe apresenta somente seu total. Pagamentos/reembolsos financeiros não foram alterados.

## Verificação reproduzível

`npm test`: testes de seleção, integração dos fluxos com serviços simulados, permissões, registros antigos, limites do mês, colaborador, vazio, mudanças de filtro durante consulta e regressões existentes.

`npm run test:despesas:browser`: navegador Edge com código do DEV, dados fictícios e jsPDF real. Verifica as três opções, download, PDF do envio, links dos comprovantes e layout em 1440, 390 e 320 px. Não acessa Firebase nem envia mensagens. Os artefatos ficam em `tests/.runtime/despesas/` (ignorados pelo Git). Requer acesso ao CDN já utilizado pelo aplicativo.

## Validação funcional no DEV antes de qualquer merge para produção

1. Com sessão ADMIN no GO-dev, selecionar uma obra e mês com ambas as categorias; comparar lista, prévia e PDF nas três opções.
2. Repetir com um colaborador, mês vazio e registro antigo sem `reembolsavel`; este deve aparecer em Empresa.
3. Com perfil de colaborador, conferir suas obras autorizadas e a ausência de obras externas. Sem vínculo, nenhuma despesa deve aparecer.
4. Conferir subtotais, total, identificação da categoria e comprovantes no relatório. Validar envio real apenas para destinatários de teste previamente configurados/autorizados; os testes automatizados interceptam o envio.
5. Registrar o aceite funcional no DEV antes de preparar o merge de produção.

## Preparação de produção — sem execução nesta etapa

Promover posteriormente apenas as mudanças do filtro/listagem (`index.html`, novo `despesas.mjs` e testes), preservando a configuração Firebase específica de produção. Não substituir o `index.html` de produção integralmente pelo DEV. Não alterar regras ou dados. Publicação, PR/merge e qualquer modificação no GO-app dependem de uma etapa posterior autorizada, após o aceite funcional no DEV.
