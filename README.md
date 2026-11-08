
# LanHouse Monitor

Sistema de gerenciamento e monitoramento de computadores para ambientes como lan houses, laboratórios de informática e salas com múltiplas estações de trabalho.

O projeto tem como objetivo centralizar o acompanhamento das máquinas, permitindo consultar suas configurações técnicas, softwares instalados, períodos de utilização, incidentes, manutenções e métricas de desempenho.

A aplicação utiliza uma arquitetura com um frontend, um backend e três bancos de dados com diferentes modelos de armazenamento, cada um responsável por um conjunto específico de informações.

---

## 1. Objetivos do projeto

- Gerenciar o cadastro técnico das máquinas.
- Consultar os softwares instalados em cada computador.
- Registrar períodos de utilização das máquinas.
- Acompanhar incidentes e manutenções.
- Monitorar métricas de hardware e rede.
- Armazenar eventos e diagnósticos técnicos.
- Disponibilizar informações por meio de uma interface centralizada.

## 2. Integrantes

- [Nome completo do integrante 1]
- [Nome completo do integrante 2]
- [Nome completo do integrante 3]

---

## 3. Arquitetura do sistema

O sistema será desenvolvido utilizando três componentes principais:

- **Frontend:** interface responsável pela interação com o operador e pela apresentação das informações.
- **Backend:** responsável pelas regras de negócio, processamento das solicitações e comunicação com os bancos de dados.
- **Bancos de dados:** responsáveis pelo armazenamento das informações, divididas conforme a natureza dos dados.

### 3.1. Visão geral

```text
                 FRONTEND
                (React)
                    |
                    |
                 BACKEND
             (Python / FastAPI)
                    |
          +---------+---------+
          |         |         |
          v         v         v
      PostgreSQL  MongoDB  Cassandra
       Relacional  Documentos  Colunas
```

Cada banco possui uma responsabilidade específica, evitando que diferentes tipos de informação sejam armazenados de maneira inadequada.

---

## 4. Bancos de dados

### 4.1. PostgreSQL

**Modelo:** Banco de dados relacional.

**Responsabilidade:** Armazenar informações estruturadas e que possuem relacionamentos entre si.

Principais informações:

- Cadastro técnico das máquinas.
- Especificações de hardware.
- Catálogo de softwares.
- Associação entre máquinas e softwares instalados.
- Períodos de utilização das máquinas, sem identificação de usuários.
- Registro de incidentes.
- Histórico de manutenções.
- Informações do contrato de internet.

**Motivo da escolha:**

O PostgreSQL oferece suporte a transações, integridade referencial, restrições e relacionamentos entre tabelas. Essas características são importantes para manter a confiabilidade dos dados administrativos e técnicos do sistema.

### 4.2. MongoDB

**Modelo:** Banco de dados NoSQL orientado a documentos.

**Responsabilidade:** Armazenar eventos técnicos, logs e diagnósticos das máquinas.

Principais informações:

- Eventos registrados durante a utilização dos computadores.
- Registros de erros e falhas.
- Diagnósticos técnicos.
- Informações complementares sobre ocorrências.
- Registros com estruturas que podem variar conforme o tipo de evento.

**Motivo da escolha:**

O MongoDB utiliza documentos BSON, permitindo armazenar informações com estruturas flexíveis. Isso facilita o registro de diferentes tipos de eventos técnicos sem exigir que todos possuam exatamente os mesmos campos.

### 4.3. Apache Cassandra

**Modelo:** Banco de dados NoSQL orientado a colunas largas (*wide-column store*).

**Responsabilidade:** Armazenar métricas e informações de monitoramento das máquinas ao longo do tempo.

Principais informações:

- Consumo de CPU.
- Utilização de memória RAM.
- Utilização do armazenamento.
- Tráfego e utilização da rede.
- Estado de funcionamento das máquinas.
- Programas em execução e último horário de execução.
- Informações temporais de monitoramento.

**Motivo da escolha:**

O Cassandra foi escolhido por sua arquitetura distribuída, capacidade de escrita em grande volume e suporte a replicação. Essas características são adequadas para o armazenamento contínuo de métricas produzidas pelas máquinas monitoradas.

---

## 5. Tecnologias e linguagens

| Componente | Tecnologia | Justificativa |
|---|---|---|
| Frontend | JavaScript + React | Criação de interfaces dinâmicas e componentes reutilizáveis. |
| Backend | Python + FastAPI | Desenvolvimento simplificado de APIs REST e facilidade de integração. |
| Servidor da API | Uvicorn | Execução da aplicação FastAPI por meio do protocolo ASGI. |
| Banco relacional | PostgreSQL / SQL | Manipulação de dados estruturados e relacionamentos. |
| Banco documental | MongoDB / BSON | Armazenamento flexível de eventos e logs. |
| Banco distribuído | Cassandra / CQL | Armazenamento distribuído de métricas temporais. |

O backend será responsável por intermediar toda a comunicação entre o frontend e os três bancos de dados.

---

## 6. Teorema CAP e disponibilidade

O teorema CAP estabelece que, diante de uma partição de rede em um sistema distribuído, não é possível garantir simultaneamente:

- **Consistency (Consistência):** todos os nós apresentam os dados mais recentes de maneira consistente.
- **Availability (Disponibilidade):** toda solicitação a um nó que não falhou recebe uma resposta.
- **Partition Tolerance (Tolerância a partições):** o sistema continua operando mesmo quando ocorre uma falha de comunicação entre nós.

No projeto, a indisponibilidade de um banco poderá afetar somente as funcionalidades que dependem diretamente dele, desde que não exista uma operação que necessite consultar simultaneamente os três bancos.

### 6.1. PostgreSQL

O PostgreSQL será utilizado inicialmente como uma instância relacional.

Caso fique indisponível, as funcionalidades que dependem de seus dados, como consulta às máquinas cadastradas, softwares, incidentes e manutenções, ficarão temporariamente indisponíveis.

Como não foi definida uma configuração de replicação para esse banco, sua recuperação dependerá do restabelecimento da instância ou de uma estratégia adicional de recuperação.

### 6.2. MongoDB

O MongoDB utilizará um Replica Set com três membros.

Caso o membro primário fique indisponível, os membros restantes poderão realizar uma eleição para escolher um novo primário.

Durante esse processo, as operações de escrita poderão ficar temporariamente indisponíveis.

Com três membros votantes, dois votos são necessários para formar a maioria. Portanto, uma instância poderá ficar indisponível sem impedir a eleição de um novo primário.

### 6.3. Cassandra

O Cassandra utilizará três nós, com fator de replicação igual a três.

Isso significa que cada dado terá três réplicas distribuídas entre os nós.

Será utilizado o nível de consistência `QUORUM`, que exige respostas de pelo menos duas réplicas para concluir uma operação de leitura ou escrita.

Assim, uma instância poderá ficar indisponível e ainda será possível atingir o quórum. Caso duas instâncias fiquem indisponíveis, as operações que exigem esse nível de consistência não poderão ser concluídas.

---

## 7. Consistência dos dados

Cada banco utiliza mecanismos próprios para garantir a confiabilidade das informações.

### 7.1. PostgreSQL

O PostgreSQL utiliza as propriedades ACID:

- **Atomicidade:** uma transação é executada integralmente ou não é executada.
- **Consistência:** as operações respeitam as restrições e regras definidas no banco.
- **Isolamento:** transações simultâneas não devem interferir indevidamente umas nas outras.
- **Durabilidade:** transações confirmadas permanecem armazenadas mesmo após falhas.

### 7.2. MongoDB

O MongoDB oferece mecanismos configuráveis de consistência por meio de:

- **Read Concern:** define o nível de garantia dos dados retornados nas leituras.
- **Write Concern:** define quantas confirmações são necessárias para considerar uma escrita concluída.
- **Replica Set:** mantém cópias dos dados em diferentes membros e permite a eleição de um novo primário em caso de falha.

A configuração desses mecanismos permite controlar o equilíbrio entre consistência, desempenho e disponibilidade.

### 7.3. Cassandra

O Cassandra permite definir níveis de consistência para operações de leitura e escrita.

Neste projeto, será utilizado `QUORUM`, exigindo respostas da maioria das réplicas disponíveis para concluir as operações.

Com fator de replicação três, duas respostas são suficientes para atingir o quórum.

Quando leitura e escrita utilizam `QUORUM`, a interseção entre as réplicas consultadas permite obter consistência forte para essas operações, considerando que não haja outras condições de concorrência ou falhas que invalidem essa garantia.

---

## 8. Replicação e tolerância a falhas

Os bancos não relacionais utilizarão três instâncias para distribuir os dados e reduzir o impacto de falhas individuais.

### 8.1. MongoDB – Replica Set

Configuração planejada:

- 3 membros votantes.
- 1 membro primário.
- 2 membros secundários.
- Replicação dos dados entre os membros.

Com essa configuração, uma instância poderá ficar indisponível e ainda será possível manter a maioria necessária para a eleição de um novo primário.

Caso duas instâncias fiquem indisponíveis, o membro restante não terá maioria para eleger um primário, impedindo novas operações de escrita.

### 8.2. Cassandra – Replicação

Configuração planejada:

- 3 nós.
- Fator de replicação igual a 3.
- Nível de consistência `QUORUM`.

Com três réplicas, duas respostas são necessárias para concluir uma operação.

| Instâncias indisponíveis | Réplicas restantes | Operações com QUORUM |
|---|---:|---|
| 0 | 3 | Disponíveis |
| 1 | 2 | Disponíveis |
| 2 | 1 | Indisponíveis |

Dessa maneira, o Cassandra poderá continuar realizando operações que exigem `QUORUM` mesmo com a indisponibilidade de um dos nós.

### 8.3. Resumo da tolerância a falhas

| Banco | Configuração | Instâncias indisponíveis toleradas |
|---|---|---:|
| PostgreSQL | Instância única, sem replicação definida | 0 |
| MongoDB | Replica Set com 3 membros | 1 |
| Cassandra | 3 nós, fator de replicação 3 e QUORUM | 1 |

---

## 9. Organização dos dados

A separação das informações entre os bancos seguirá a seguinte lógica:

| Informação | Banco responsável |
|---|---|
| Cadastro técnico das máquinas | PostgreSQL |
| Especificações de hardware | PostgreSQL |
| Softwares instalados | PostgreSQL |
| Períodos de utilização | PostgreSQL |
| Incidentes e manutenções | PostgreSQL |
| Contrato de internet | PostgreSQL |
| Eventos técnicos e logs | MongoDB |
| Diagnósticos técnicos | MongoDB |
| Consumo de CPU e RAM | Cassandra |
| Utilização de disco e rede | Cassandra |
| Estado observado das máquinas | Cassandra |
| Programas em execução e horários | Cassandra |

Essa divisão busca utilizar as características de cada banco de dados de acordo com o tipo de informação armazenada.

---

## 10. Considerações finais

O LanHouse Monitor propõe uma arquitetura que combina diferentes modelos de bancos de dados para atender às necessidades de gerenciamento e monitoramento de computadores.

O PostgreSQL será responsável pela integridade das informações estruturadas, o MongoDB pelo armazenamento flexível de eventos e diagnósticos, e o Cassandra pelo armazenamento distribuído de métricas temporais.

A utilização conjunta dessas tecnologias permite explorar diferentes estratégias de persistência, consistência, replicação e tolerância a falhas em uma aplicação prática.
