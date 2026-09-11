# Projeto Integrador
Sistema de identificação de rotas otimizadas para bombeiros usando redes neurais.

---

## O que o sistema faz

Dado um ponto de origem (quartel de bombeiros) e um ponto de destino (local da ocorrência), o sistema calcula a rota de menor tempo estimado pela cidade de Taubaté usando um grafo de ruas real do OpenStreetMap e uma rede neural treinada para estimar o custo de travessia de cada rua.

A rota encontrada não é necessariamente a mais curta em metros — é a que a rede neural considera mais rápida, levando em conta o tipo de via, a velocidade máxima permitida e o contexto do entorno de cada trecho.

---

## Como a rede neural funciona (versão didática)

A rede neural é o core do projeto. Ela recebe informações sobre cada rua do mapa e aprende a estimar quanto tempo um veículo de emergência levaria para percorrê-la.

### Por que não usar só a distância?

Uma rua de 500 metros em uma rodovia é bem diferente de uma rua de 500 metros em um beco residencial. A distância sozinha ignora isso. A rede neural aprende a diferenciar esses casos.

### O que é uma GNN (Graph Neural Network)?

O mapa de ruas é um **grafo**: um conjunto de pontos (cruzamentos) conectados por arestas (ruas). Uma GNN é um tipo de rede neural projetada para trabalhar com grafos.

A grande vantagem de uma GNN em relação a uma rede simples é que ela aprende em **rodadas de propagação**. Em cada rodada, cada ponto do mapa "olha para os vizinhos" e atualiza sua própria representação com base no que viu. Depois de 2 rodadas, cada ponto carrega informação de vizinhos até 2 ruas de distância. Depois de 3 rodadas, 3 ruas — e assim por diante.

Para o projeto isso significa que ao calcular o custo de uma rua A→B, a rede sabe não só o que é essa rua, mas também o que está ao redor de B: quais vias chegam, se há uma rodovia 2 quadras adiante, se o trecho seguinte é estreito. Isso é a consciência de contexto que uma rede simples não tem.

### Arquitetura atual: GAT + MLP

O modelo usa duas peças combinadas:

**GAT (Graph Attention Network)** — é o encoder de contexto. Ele processa o grafo inteiro em 2 rodadas de propagação usando um mecanismo de atenção: cada nó aprende a dar mais ou menos importância para cada vizinho dependendo do contexto. Isso é mais sofisticado do que simplesmente calcular a média dos vizinhos.

**MLP (Multi-Layer Perceptron)** — é o regressor. Depois que o GAT gera um embedding (uma representação densa de contexto) para cada nó, a MLP recebe `[embedding_origem + embedding_destino + features_da_rua]` e produz um número: o custo estimado em segundos.

### Features de entrada

Cada rua do mapa fornece 9 informações para o modelo:

| Feature | O que representa |
|---|---|
| `length` | Comprimento em metros |
| `speed_kmh` | Velocidade máxima inferida pelo tipo de via |
| `lanes` | Número de faixas |
| `oneway` | Mão única (1.0) ou dupla (0.0) |
| `highway_group` | Tipo de via em one-hot: rodovia, primária, secundária, terciária ou local |

### O que é one-hot encoding?

One-hot encoding é uma forma de representar categorias como números. Em vez de dizer "o tipo desta via é 2", criamos 5 colunas (uma por tipo) e colocamos 1 na coluna correta e 0 nas outras. Isso evita que a rede interprete erroneamente que "tipo 4 é melhor que tipo 1" só porque o número é maior.

### O que é loss?

Loss (ou função de perda) é uma medida de o quanto as estimativas da rede estão erradas em relação aos valores reais. Durante o treino, o objetivo é minimizar essa medida. Começar com loss alta e ver ela cair ao longo das épocas é o comportamento esperado e correto.

### O que é uma época?

Uma época é uma passagem completa pelo conjunto de dados de treino. Com 500 ou 800 épocas, o modelo passa pelo mapa inteiro essa quantidade de vezes, ajustando os pesos a cada passagem.

### O que é learning rate (LR)?

O learning rate controla o tamanho do passo que o modelo dá a cada ajuste. Um LR muito alto faz o modelo pular a solução ótima; muito baixo faz o treino demorar demais. O sistema usa um scheduler que reduz o LR automaticamente quando a melhora começa a estagnar.

---

## Split de treino e validação

O sistema separa as arestas do grafo em dois conjuntos antes de treinar:

- **85% para treino** — o modelo vê e aprende com essas arestas
- **15% para validação** — o modelo nunca vê essas arestas durante o treino; elas servem apenas para medir se ele está generalizando

Isso é importante porque sem validação não há como saber se o modelo está aprendendo padrões gerais ou apenas memorizando as ruas que viu. Se a loss de validação acompanha a de treino (como aconteceu no output abaixo), o modelo está generalizando bem.

**Output real do treino:**
```
   Epoca   Loss Treino    Loss Val  Melhor Val          LR
--------------------------------------------------
      50/800        0.2371      0.2335      0.2335    0.000300
     150/800        0.0818      0.0717      0.0717    0.000300
     300/800        0.0624      0.0578      0.0578    0.000300
     500/800        0.0580      0.0548      0.0548    0.000300
     750/800        0.0567      0.0542      0.0542    0.000150
     800/800        0.0566      0.0541      0.0541    0.000075

Treinamento concluido. Melhor loss de validacao: 0.0541
```

A loss de validação ficou consistentemente abaixo da loss de treino em todo o processo — sinal de generalização saudável, sem overfitting.

---

## Por que a versão com GNN anterior quebrava (NaN desde a época 1)

A tentativa anterior usava GATConv mas produzia NaN imediatamente. Os motivos foram:

**IDs mal mapeados:** O grafo OSMnx usa IDs arbitrários para os nós (ex: `123456789`). O GATConv usa esses valores como índices diretos em matrizes de tamanho N. Tentar acessar a posição `123456789` em uma matriz com 8601 linhas resulta em acesso fora dos limites — NaN imediato. A correção foi remapear todos os IDs para índices contíguos de 0 a N-1 antes de qualquer operação.

**Features não normalizadas:** O mecanismo de atenção do GAT calcula `softmax` sobre os scores de atenção. Com `length` na casa dos centenas de metros e `speed_kmh` na casa dos dezenas, os valores dos scores ficam gigantes antes do softmax, causando overflow numérico. A correção foi normalizar todas as features para média 0 e desvio padrão 1 antes de entrar na rede.

---

## AVISO IMPORTANTE: Python 3.12

O Fedora 43 vem com Python 3.14 por padrão, que ainda é incompatível com as principais bibliotecas de ML usadas neste projeto (`torch`, `torchvision`, `networkx`, `triton`, etc.).

Isso não é um bug. É o ciclo de suporte das bibliotecas — o Python 3.12 é a versão estável com suporte garantido para todo o ecossistema de ML hoje. Trocar para o 3.12 não quebra nada no sistema. O Python 3.14 continua instalado; o 3.12 é usado apenas dentro do ambiente virtual do projeto.

---

## Setup no Fedora Linux

### 1. Instalar dependências de sistema
```bash
sudo dnf install -y make gcc gcc-c++ cmake git python3.12 python3.12-devel
```

### 2. Configurar o Python 3.12 como alternativa no sistema
```bash
sudo alternatives --install /usr/bin/python3 python3 /usr/bin/python3.12 1
sudo alternatives --install /usr/bin/python3 python3 /usr/bin/python3.14 2
sudo alternatives --config python3
# Selecione o Python 3.12 na lista interativa
```

### 3. Instalar o pip no Python 3.12
O pip do sistema está vinculado ao Python 3.14, então instale manualmente no 3.12:
```bash
curl https://bootstrap.pypa.io/get-pip.py -o get-pip.py
python3.12 get-pip.py
python3.12 -m pip --version  # deve mostrar python 3.12
```

### 4. Instalar o Poetry
```bash
curl -sSL https://install.python-poetry.org | python3.12 -
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
poetry --version
```

Alias para ativar o ambiente virtual (Poetry 2.x removeu o `poetry shell`):
```bash
echo "alias pshell='eval \$(poetry env activate)'" >> ~/.bashrc
source ~/.bashrc
```

### 5. Configurar o projeto
```bash
cd machine/
poetry env use python3.12
# Verificar o pyproject.toml — a linha requires-python deve ser:
# requires-python = ">=3.12,<3.13"
poetry add torch torchvision numpy pandas networkx osmnx folium geopy pybind11 scikit-learn torch-geometric
poetry add --group dev pytest black isort mypy
```

### 6. Ativar o ambiente virtual
```bash
pshell
```

---

## Setup no Windows

### 1. Instalar dependências
- Python 3.12: https://www.python.org/downloads/ (marcar "Add to PATH")
- Git: https://git-scm.com
- CMake: https://cmake.org
- Visual Studio Build Tools: https://visualstudio.microsoft.com/visual-cpp-build-tools/
  - Selecionar "Desenvolvimento para desktop com C++"

### 2. Instalar o Poetry
```powershell
(Invoke-WebRequest -Uri https://install.python-poetry.org -UseBasicParsing).Content | python -
```

### 3. Configurar o projeto
```powershell
cd machine/
poetry env use python
poetry add torch torchvision numpy pandas networkx osmnx folium geopy pybind11 scikit-learn torch-geometric
poetry add --group dev pytest black isort mypy
```

---

## Compilar o módulo C++

O módulo C++ (`NodeMemoryManager`) gerencia a memória dos custos neurais de cada aresta do grafo durante a execução. Deve ser compilado apontando explicitamente para o Python 3.12 do ambiente virtual do Poetry.

```bash
# Dentro de machine/src/cpp/
mkdir build && cd build
cmake ..
make
```

No Windows (Developer PowerShell for VS):
```powershell
mkdir build && cd build
cmake .. -DCMAKE_BUILD_TYPE=Release `
  -DPython3_EXECUTABLE=$(poetry env info --executable) `
  -Dpybind11_DIR=$(poetry run python -c "import pybind11; print(pybind11.get_cmake_dir())")
cmake --build . --config Release
```

O arquivo gerado deve ser `memory_manager.cpython-312-x86_64-linux-gnu.so` no Linux ou `memory_manager.cpython-312-*.pyd` no Windows. Se aparecer `cpython-314`, o CMake pegou o Python errado — verifique se o `python3.12-devel` está instalado e repita.

### Como o módulo C++ é usado

Após `apply_neural_weights` calcular o `neural_cost` de cada aresta, o `main.py` instancia o `NodeMemoryManager` e aloca um buffer de 1 float por aresta para armazenar esses custos fora do heap do Python. Isso libera o GC do Python da responsabilidade de gerenciar esses valores durante o cálculo da rota.

```python
mem = NodeMemoryManager(1)  # buffer_size=1 float por aresta
edge_cache = cache_neural_costs(graph, mem)
# ... cálculo da rota ...
for buf_idx in edge_cache.values():
    mem.free_buffer(buf_idx)
```

---

## Treinar a rede neural

O treinamento deve ser feito antes de rodar o sistema pela primeira vez. Ele baixa o mapa de Taubaté via OpenStreetMap, extrai as features de cada rua, calcula o tempo real de travessia por fórmula física e treina a rede neural para aproximar esse valor.

```bash
cd machine/
pshell
python src/pathfinding/train.py
```

O modelo treinado é salvo em `machine/models/path_network.pth`. Este arquivo não deve ser commitado no Git (já está no .gitignore).

### O que esperar do treinamento

Um bom treinamento mostra queda consistente em ambas as colunas de loss (treino e validação), com a diferença entre elas permanecendo pequena e estável:

```
   Epoca   Loss Treino    Loss Val  Melhor Val          LR
--------------------------------------------------
      50/800        0.2371      0.2335      0.2335    0.000300
     200/800        0.0693      0.0633      0.0633    0.000300
     500/800        0.0580      0.0548      0.0548    0.000300
     800/800        0.0566      0.0541      0.0541    0.000075
```

Loss de validação final abaixo de 0.06 é considerada boa para este problema.

### Sinal de overfitting (o que evitar)

Se a loss de treino continuar caindo mas a loss de validação começar a subir, o modelo está memorizando as ruas que viu e perdendo capacidade de generalizar. O early stopping interrompe o treino automaticamente nesse caso e restaura o melhor estado do modelo.

### Por que normalizar os dados

Sem normalização, features com escalas muito diferentes (comprimento em metros vs. tipo de via de 0 a 1) desestabilizam o treinamento — especialmente o mecanismo de atenção do GAT, que pode entrar em overflow numérico. A normalização padroniza tudo para média 0 e desvio padrão 1. Os parâmetros de normalização são salvos junto com o modelo no `.pth` e usados para desnormalizar a saída da rede de volta para segundos reais durante a inferência.

### Por que o scikit-learn é uma dependência

O `osmnx` usa o scikit-learn internamente para busca de vizinho mais próximo (KD-Tree) ao localizar o nó do grafo mais próximo de uma coordenada. Não é chamado diretamente no código do projeto.

---

## Rodar o sistema

```bash
cd machine/
pshell
python main.py
```

O sistema vai pedir as coordenadas interativamente, exibir o resultado no terminal e gerar o arquivo `machine/rota.html` com o mapa interativo:

```
--------------------------------------------------
Sistema de Rota para Bombeiros
--------------------------------------------------
Coordenadas do Ponto de Bombeiros (origem)
  Latitude  (ex: -23.026): -23.026
  Longitude (ex: -45.555): -45.555
Coordenadas da Ocorrencia (destino)
  Latitude  (ex: -23.026): -23.018
  Longitude (ex: -45.540): -45.540
--------------------------------------------------
Processando...
  Carregando mapa de Taubaté, São Paulo, Brasil...
  Carregando modelo treinado...
  Aplicando pesos da rede neural nas arestas do grafo...
  Cacheando custos neurais no gerenciador C++...
  Calculando melhor rota...
--------------------------------------------------
MELHOR ROTA CALCULADA
--------------------------------------------------
  Distancia total : 7.48 km  (7476 m)
  Tempo estimado  : 11.8 minutos
  Nos no caminho  : 38 pontos
--------------------------------------------------
  Gerando mapa...
  Mapa salvo em: machine/rota.html
```

### Mapa interativo

O arquivo `rota.html` exibe as rotas sobrepostas no mapa de Taubaté:

- **Azul — Rota Neural:** menor tempo estimado, considera tipo e velocidade de cada via e o contexto do entorno via GNN
- **Vermelha — Rota Mais Curta:** menor distância em metros, sem considerar velocidade

Uma box no canto inferior esquerdo mostra a distância (km/m) e o tempo estimado (minutos) de cada rota lado a lado para comparação direta.

> O mapa usa o tile server CartoDB Positron. Ao abrir o `rota.html` diretamente no navegador como arquivo local (`file://`), o tile pode não carregar dependendo do navegador — isso é uma limitação de segurança do `file://` e desaparece quando o sistema for servido via HTTP em um servidor.

---

## Rodar a stack completa (backend + IA)

O `main.py` acima é o modo interativo, útil para testar a rede sozinha. O
sistema de verdade tem três processos, que sobem **nesta ordem**:

### 1. Banco de dados

O PostgreSQL precisa estar rodando. No Windows o cluster fica em `C:\pgsql-data`
(fora do OneDrive, para não arriscar corrupção por sincronização).

```bash
cd backend/
npx prisma migrate deploy   # aplica as migrations
npx prisma generate         # regenera o client do Prisma
npx prisma db seed          # hierarquia de unidades
```

O seed cria a cadeia de unidades `CCB > CBI-1 > 11GB > PB-TAUBATE`.

### 2. Serviço de IA (FastAPI, porta 8000)

```bash
cd machine/
poetry run uvicorn api.main:app --host 127.0.0.1 --port 8000
```

Esse serviço é a ponte entre a rede neural e o backend. Ele carrega o grafo de
Taubaté e aplica a GAT em todas as arestas **uma única vez, na inicialização** —
por isso demora algumas dezenas de segundos para ficar pronto. Espere a linha:

```
Route engine ready: 8610 nodes, 20070 edges from Taubaté, São Paulo, Brasil
```

Ou consulte `http://127.0.0.1:8000/health` até `engine_loaded` virar `true`.

| Rota | O que faz |
|------|-----------|
| `GET /health` | Diz se o serviço está de pé e se o modelo carregou |
| `GET /model` | Versão do modelo, cidade, tamanho do grafo |
| `POST /routes` | Recebe origem e destino, devolve a rota neural **e** a mais curta |
| `POST /training` | Dispara um novo treino em segundo plano |
| `GET /training/{id}` | Progresso do treino |

O serviço não tem banco e não sabe o que é uma ocorrência: ele só responde
"qual o melhor caminho entre esses dois pontos". Toda a regra de negócio fica
no Node.

Coordenadas a mais de 2 km da malha viária mapeada são recusadas com 400. Sem
esse limite, um erro de digitação apontando para outro estado ainda assim seria
"grudado" em alguma esquina de Taubaté, devolvendo uma rota confiante e sem
sentido.

### 3. Backend (Fastify, porta 3333)

```bash
cd backend/
npm install
npm run dev
```

A API sobe em `http://localhost:3333/api/v1`. O backend funciona mesmo com o
serviço de IA fora do ar — mas aí `/ai/routes` responde 503, e um despacho é
criado sem rota (com o aviso na resposta), porque uma indisponibilidade da IA
nunca pode impedir o envio de uma viatura.

### 4. Frontend (Vite, porta 5173)

```bash
cd frontend/
npm install
npm run dev
```

A interface sobe em `http://localhost:5173` e fala **só** com o backend — ela
nunca chama a porta 8000 diretamente. O endereço da API vem de `VITE_API_URL` e
cai em `http://127.0.0.1:3333/api/v1` quando a variável não existe.

**Não há login.** A interface abre direto no painel operacional. O sistema é um
console de emergência: quem atende o 193 está com alguém na linha, e uma tela de
autenticação entre o operador e o formulário de ocorrência custa segundos que
pertencem à chamada. A API também é aberta — o controle de acesso, num uso real,
seria feito pela rede em que o console roda, não por uma senha digitada durante
um incêndio.

> No Windows, `npm run dev` do backend usa `tsx --watch`, que reage a cada
> evento de arquivo. Com o projeto dentro do OneDrive a sincronização dispara
> eventos sem parar e o servidor entra em laço de reinício sem nunca escutar na
> porta. Nesse caso rode `npx tsx ./src/server.ts`, sem o watcher.

### Popular o banco com um ano de ocorrências

```bash
cd backend/
npm run seed:occurrences
```

O `backend/prisma/seed.ts` cria a hierarquia de unidades. Já
o `backend/scripts/seed-occurrences.ts` escreve **370 ocorrências ao longo de
doze meses**, com bairros de peso diferente, sazonalidade, perfis de horário por
natureza e endereços recorrentes — é o que faz a tela de estatísticas ter o que
mostrar.

Ele é determinístico e grava um backup do que vai apagar em `backend/.backups/`
antes de mexer. **Atenção:** apagar uma ocorrência arrasta seus despachos e as
rotas calculadas para eles.

### Principais rotas da API

Nenhuma exige autenticação: o console é aberto por decisão de projeto (veja a
seção do frontend acima).

| Recurso | O que é |
|---------|----------|
| `/units` | Unidades da corporação (hierarquia autorrelacionada) |
| `/firefighters` | Efetivo |
| `/vehicles` | Viaturas |
| `/crews` | Guarnições |
| `/shifts` | Escalas de plantão |
| `/occurrences` | Ocorrências |
| `/dispatches` | Despacho de viatura para a ocorrência |
| `/ai/routes`, `/ai/model`, `/ai/training` | Ponte com a IA |
| `GET /realtime` | WebSocket com os eventos do despacho |

O WebSocket transmite `occurrence.created`, `occurrence.updated`,
`dispatch.created`, `dispatch.updated` e `vehicle.moved`. Basta abrir
`ws://localhost:3333/api/v1/realtime` — não há handshake de autenticação.

### Ciclo de vida de um despacho

Criar um despacho faz três coisas numa transação só: registra o despacho, marca
a viatura como `EMPENHADA` e move a ocorrência para `DESPACHADA`. Logo depois a
rota é calculada pela IA, e as duas variantes (neural e Dijkstra) são gravadas
lado a lado — é essa comparação que o projeto existe para demonstrar.

O despacho anda por estados fixos, e pular etapa é recusado com 400:

```
DESPACHADO -> A_CAMINHO -> NO_LOCAL -> RETORNANDO -> FINALIZADO
     |             |
     +-------------+--> CANCELADO   (só antes de chegar ao local)
```

`NO_LOCAL` move a ocorrência para `EM_ATENDIMENTO`; `FINALIZADO` e `CANCELADO`
liberam a viatura de volta para `DISPONIVEL`.

### Teste de ponta a ponta

Com os três processos no ar:

```bash
cd backend/
npm run test:e2e
```

O script `backend/scripts/e2e-test.mjs` exercita a API como um cliente real —
todos os CRUDs, o ciclo do despacho, o WebSocket e a ponte com a IA, sem
nenhum stub. Passar todas significa que Node, Postgres e o
serviço Python estão realmente conversando entre si.

### Testes unitários

Diferente do e2e, os testes unitários (`backend/tests/`, rodados com Jest) não
precisam do Postgres nem do serviço de IA no ar — cada teste mocka o Prisma
Client (`jest.mock(".../config/prisma.js", ...)`) e, quando necessário, o
`AiClient`, então rodam isolados e em segundos.

```bash
cd backend/
npm test              # roda a suite uma vez
npm run test:watch    # modo watch
npm run test:coverage # com relatório de cobertura
```

Cobrem as regras de negócio dos services — hierarquia e ciclos em `Unit`,
unicidade de CPF/matrícula/placa, a máquina de estados de `Dispatch` e
`Occurrence`, o mapeamento de erros para status HTTP, o `AiClient` (sucesso,
4xx, 5xx, timeout e falha de rede) — e não tocam banco real nem o serviço
Python. `backend/jest.config.cjs` documenta duas peculiaridades do setup:

- o cliente Prisma gerado usa `import.meta.url` no topo do arquivo (sintaxe
  ESM), incompatível com a transformação para CommonJS que o Jest usa aqui;
  por isso `tests/mocks/generated-prisma-client.ts` substitui esse módulo nos
  testes, expondo só o que os services realmente usam em runtime dele
  (`Prisma.Decimal`) — o resto é só tipo, apagado na compilação;
- `resetMocks: true` limpa a implementação de cada mock antes de cada teste,
  então qualquer mock "estrutural" (como `prisma.$transaction` chamando de
  fato o callback recebido, ou `new AiClient()` retornando um objeto com
  métodos mockados) precisa ser religado em um `beforeEach` — os testes de
  `CreateDispatchService`, `UpdateDispatchService` e `training-service`
  mostram o padrão.

---

## Estrutura do Projeto

```
projeto-integrador/
├── machine/
│   ├── api/                   # Serviço FastAPI que expõe a IA ao backend
│   │   ├── __init__.py
│   │   ├── main.py            # Rotas HTTP: /health, /model, /routes, /training
│   │   ├── engine.py          # Grafo + modelo carregados uma vez, em memória
│   │   └── training.py        # Roda o train.py como subprocesso, um job por vez
│   ├── models/                # Modelo treinado (gerado localmente, no .gitignore)
│   ├── rota.html              # Mapa gerado ao rodar main.py (no .gitignore)
│   ├── src/
│   │   ├── neural/
│   │   │   ├── __init__.py
│   │   │   └── path_network.py       # Arquitetura GAT + MLP
│   │   ├── pathfinding/
│   │   │   ├── __init__.py
│   │   │   ├── pathfinder.py         # Inferência: constrói tensores, aplica pesos, Dijkstra
│   │   │   ├── map_visualizer.py     # Geração do mapa HTML com as duas rotas
│   │   │   └── train.py              # Script de treinamento com split treino/validação
│   │   └── cpp/
│   │       ├── build/                # Compilado localmente (no .gitignore)
│   │       ├── stubs/
│   │       │   └── memory_manager.pyi
│   │       ├── CMakeLists.txt
│   │       └── memory-manager.cpp
│   ├── tests/
│   ├── main.py
│   ├── pyproject.toml
│   ├── poetry.lock
│   └── pyrightconfig.json
├── backend/
│   ├── prisma/
│   │   ├── migrations/
│   │   ├── schema.prisma      # Modelo de domínio (unidades, viaturas, ocorrências...)
│   │   └── seed.ts            # Hierarquia de unidades
│   ├── scripts/
│   │   └── e2e-test.mjs       # Teste de ponta a ponta da stack inteira
│   ├── tests/
│   │   ├── mocks/             # Stub do client Prisma gerado, só para o Jest
│   │   ├── setup-env.cjs      # Env vars exigidas por config/env.ts nos testes
│   │   └── unit/              # Testes de services, utils e mapeamento de erros
│   ├── jest.config.cjs
│   ├── src/
│   │   ├── @types/            # Augmentação de tipos do Fastify
│   │   ├── config/            # env validado com zod, client do Prisma
│   │   ├── controllers/       # Um arquivo por operação: valida e chama o service
│   │   ├── errors/            # Erros de domínio + mapeamento para status HTTP
│   │   ├── generated/         # Client do Prisma (no .gitignore)
│   │   ├── plugins/           # realtime (WebSocket)
│   │   ├── realtime/          # Fan-out dos eventos de despacho
│   │   ├── routes/            # Registro das rotas por entidade
│   │   ├── services/          # Regras de negócio, uma classe por operação
│   │   ├── utils/
│   │   └── server.ts          # Sobe o Fastify e registra os plugins
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── src/
│   │   ├── api/               # Cliente HTTP, endpoints, tipos e tradução de mensagens
│   │   ├── components/
│   │   │   ├── charts/        # Gráficos em SVG: treinamento e distribuições
│   │   │   ├── layout/        # Kit visual: painéis, tabelas, campos, modal
│   │   │   ├── mapa/          # Mapa de rota (2D/3D) e mapa de ocorrências
│   │   │   └── ui/            # Primitivas do shadcn usadas pela barra
│   │   ├── hooks/             # useResource, useMutation, useRealtime, useMeasure
│   │   ├── lib/               # Formatação, distância geodésica, utilidades
│   │   ├── pages/             # Uma tela por arquivo
│   │   ├── App.tsx            # Rotas
│   │   └── main.tsx
│   ├── index.html
│   ├── package.json
│   └── vite.config.ts
├── .gitignore
└── README.md
```

---

## .gitignore

Cada parte do projeto tem o seu próprio `.gitignore`. O que **nunca** deve ser
commitado:

**`machine/.gitignore`**

```
models/          # Modelo treinado: grande e específico de cada máquina
build/           # Módulo C++ compilado
cache/           # Cache do OSMnx
*.html           # rota.html, gerado pelo folium
.venv/
__pycache__/
```

**`backend/.gitignore`**

```
node_modules
.env                    # Contém a senha do banco
/src/generated/prisma   # Client do Prisma, refeito por `npx prisma generate`
```

O `poetry.lock` e o `package-lock.json`, ao contrário, **devem** ser commitados:
são eles que garantem que todo o time resolva exatamente as mesmas versões.

---

## Fluxo de Branches no Git

```
main        → codigo estavel, so recebe merge apos revisao
develop     → branch de integracao do time
machine     → modulo de IA e pathfinding
feature/xxx → cada integrante cria uma para sua tarefa
hotfix/xxx  → correcoes urgentes
```

### Fluxo diário

```bash
git checkout develop
git pull origin develop
git checkout -b feature/nome-da-tarefa
# trabalhar e commitar
git add .
git commit -m "feat: descricao do que foi feito"
git push origin feature/nome-da-tarefa
# Abrir Pull Request para develop no GitHub
```

### Prefixos de commit

| Prefixo | Uso |
|---|---|
| `feat:` | Nova funcionalidade |
| `fix:` | Correção de bug |
| `docs:` | Documentação |
| `refactor:` | Refatoração sem mudança de comportamento |
| `test:` | Testes |

---

## Dependências Principais

### IA (`machine/`)

| Biblioteca | Uso |
|---|---|
| `torch` / `torchvision` | Rede neural (base do PyTorch) |
| `torch-geometric` | GNN — GATConv para propagação de contexto no grafo |
| `numpy` / `pandas` | Manipulação de dados |
| `networkx` | Modelagem do grafo de ruas e algoritmo de Dijkstra |
| `osmnx` | Importar mapa real do OpenStreetMap |
| `scikit-learn` | Dependência interna do osmnx para busca KD-Tree |
| `geopy` | Geocodificação (endereço para coordenada) |
| `pybind11` | Integração Python com C++ |
| `folium` | Geração do mapa HTML interativo com as duas rotas |
| `fastapi` / `uvicorn` | Serviço HTTP que entrega a IA ao backend |

### Backend (`backend/`)

| Biblioteca | Uso |
|---|---|
| `fastify` | Servidor HTTP |
| `@fastify/websocket` | Canal de eventos em tempo real do despacho |
| `@fastify/helmet` / `@fastify/cors` / `@fastify/rate-limit` | Proteções de borda |
| `prisma` / `@prisma/client` | ORM e migrations do PostgreSQL |
| `zod` | Validação das entradas nos controllers e do `.env` |
| `tsx` | Executa o TypeScript direto, com watch no desenvolvimento |
