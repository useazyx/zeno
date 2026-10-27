# Histórico demonstrativo

## Distribuição geográfica — 25/09/2026

72.669 ocorrências sintéticas encerradas/canceladas foram redistribuídas ao longo
de segmentos de ruas nomeadas do cache OSM local. O sorteio usa comprimento de rua
e decaimento suave ao redor dos bairros, substituindo as caixas retangulares.
Números de imóveis e bairros continuam demonstrativos; não são geocodificação
oficial nem reconstrução da malha histórica de 2001.

Os registros de um mesmo endereço mantêm um único local e sua frequência de
recorrência. Datas, estados e vínculos foram verificados após a gravação.
750 registros foram preservados: endereços com atendimento ativo ou rota salva
(incluindo todas as recorrências desses endereços). Nenhuma rota foi recalculada.

```powershell
# Inspecionar sem gravar (também é o comportamento sem argumentos)
.\node_modules\.bin\tsx.cmd scripts/repair-demo-geography.ts --preview
# Aplicar uma vez; registros já corrigidos são identificados e ignorados
.\node_modules\.bin\tsx.cmd scripts/repair-demo-geography.ts --apply
# Reverter usando o backup gerado antes da transação
.\node_modules\.bin\tsx.cmd scripts/repair-demo-geography.ts --restore .backups/geography-2026-09-25T19-00-07.097Z.json.gz
```

`seed-occurrences.ts` também usa o amostrador de ruas para novas cargas.
O cache OSM em `machine/cache/` é obrigatório; sem ele o script falha antes de gravar.

## Cenário completo

Depois do histórico de ocorrências, `seed-complete-demo.ts` completa todas as
entidades e vincula os atendimentos ao efetivo e à frota de sua época:

- Hierarquia com subgrupamento municipal e quatro postos.
- 528 militares adicionais, em três gerações de efetivo e quatro equipes de revezamento.
- 36 viaturas adicionais (ABT, UR e ABTR), fabricadas antes dos respectivos atendimentos.
- Mais de 41 mil guarnições, com comandante, integrantes e mais de 152 mil escalas.
- Todos os despachos vinculados à guarnição, viatura e unidade corretas.
- Rotas neurais e Dijkstra calculadas pelo serviço de IA sobre o grafo atual, para
  uma amostra recente e mensal desde 2020. São reconstruções demonstrativas,
  identificadas em `model_version`, e não registros de trânsito histórico.
- 48 contas demonstrativas desativadas; os acessos existentes são preservados.
- 18 execuções de treinamento simuladas, identificadas por `demo://` e sinalizadas
  na tela. As nove execuções reais e o arquivo do modelo são preservados.

```powershell
.\node_modules\.bin\tsx.cmd scripts/seed-complete-demo.ts --preview
.\node_modules\.bin\tsx.cmd scripts/seed-complete-demo.ts
.\node_modules\.bin\tsx.cmd scripts/verify-complete-demo.ts
```

O script completo faz backup de **todas as onze tabelas** em arquivos JSON
compactados, na pasta ignorada `.backups/complete-demo-<data>/`, antes da transação.
Os identificadores do cenário são estáveis para evitar duplicação ao repetir a
carga. CPFs são gerados apenas para satisfazer a validação do cenário; emails
usam o domínio reservado `.example` e telefones não são contatos reais.

As listagens temporais agora usam o mais recente primeiro, com desempate por ID.
Efetivo ativo e frota operacional aparecem antes dos cadastros históricos.

## Histórico inicial de ocorrências

O gerador substitui ocorrências e seus despachos/rotas por **dados sintéticos**, de
01/01/2001 a 24/09/2026 (referência: 18h em São Paulo). Não são estatísticas oficiais.

Foram gravadas 73.419 ocorrências e 68.301 despachos, com registros nos 309 meses
do período. O volume cresce gradualmente; naturezas têm pesos por estação e hora,
bairros têm frequências diferentes e alguns endereços apresentam recorrência.
Atendimentos respeitam a disponibilidade das viaturas e a sequência chamada,
despacho, chegada e encerramento. Telefones fictícios não são gerados.

Cadastros de pessoas, unidades, viaturas e os nove treinamentos existentes foram
preservados. Apenas a disponibilidade das viaturas foi reconciliada com os novos
despachos. O histórico operacional não altera nem treina o modelo neural.

Na pasta `backend`, para validar sem gravar:

```powershell
.\node_modules\.bin\tsx.cmd scripts/seed-occurrences.ts --preview
```

Para substituir o histórico novamente (gera backup antes de gravar):

```powershell
npm run seed:occurrences
```

Para conferir a base gravada:

```powershell
.\node_modules\.bin\tsx.cmd scripts/verify-demo-history.ts
```

A substituição é transacional. O backup original desta execução está em
`backend/.backups/occurrences-2026-09-24T11-50-42-711Z.json`: 373 ocorrências,
seus despachos e rotas, além do cadastro anterior das viaturas. A pasta é ignorada
pelo Git. Os registros gerados trazem a identificação de cenário sintético na descrição.

A tela de estatísticas operacionais já limitava a leitura a 1.000 registros por
consulta e informa o recorte incompleto. Esse limite permanece; não confundir os
totais desse recorte com o histórico completo no banco. Os gráficos da IA usam
as métricas dos treinamentos, que foram mantidas sem fabricar resultados.
