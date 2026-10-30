# LanHouse Monitor

Sistema de gerenciamento e monitoramento de computadores para lan houses, desenvolvido como projeto acadêmico com foco em banco de dados, conectividade e solução de problemas reais.

## Sobre o projeto

O **LanHouse Monitor** tem como objetivo centralizar o gerenciamento das máquinas de uma lan house, permitindo acompanhar suas condições técnicas, registrar sessões de utilização e organizar informações sobre manutenção e serviços oferecidos.

A proposta é facilitar a identificação de computadores indisponíveis, problemas recorrentes e utilização dos recursos, fornecendo ao responsável uma visão geral do ambiente em uma única aplicação. A principal intenção é entender como diferentes bancos e tecnologias podem ajudar em uma situação real de gerencia de comércio.

O projeto também busca explorar o uso de diferentes modelos de bancos de dados, aplicando cada tecnologia a um tipo de informação específico.

## Objetivos

- Gerenciar o cadastro e as informações técnicas dos computadores.
- Acompanhar o estado das máquinas e o consumo de recursos.
- Registrar sessões de utilização, incluindo máquina, usuário, duração e valor pago.
- Manter registros de manutenção e incidentes técnicos.
- Consultar o histórico de métricas e eventos das máquinas.
- Aplicar operações CRUD.
- Estudar consistência, disponibilidade, conceitos e limitações de diferentes bancos de dados.

## Arquitetura

A aplicação segue uma arquitetura composta exclusivamente por:

- **Frontend (FE):** interface para visualização e gerenciamento das informações.
- **Backend (BE):** API responsável pelas regras de negócio, validações e comunicação com os bancos.
- **PostgreSQL (RDB):** banco de dados relacional.
- **MongoDB (DB1):** banco de dados documental.
- **Apache Cassandra (DB2):** banco de dados orientado a colunas largas.

```text
                 +----------------------+
                 |      Frontend        |
                 |   Interface Web      |
                 +----------+-----------+
                            |
                            v
                 +----------------------+
                 |       Backend        |
                 |       API REST       |
                 +----+--------+--------+
                            |   
              +-------+---+----+----------------+
              |           |                     |
              v           v                     v
        +-----------+ +-----------+     +----------------+
        | PostgreSQL| |  MongoDB  |     |   Cassandra    |
        |   RDB     | |   DB1     |     |      DB2       |
        +-----------+ +-----------+     +----------------+
```

## Bancos de dados

### PostgreSQL — dados relacionais

Responsável pelos dados cadastrais e transacionais que exigem relacionamentos e integridade.

Principais informações:

- Cadastro das máquinas e suas especificações.
- Sessões de utilização, com horário de início e término.
- Valores cobrados e pagamentos registrados.
- Planos e serviços oferecidos pela lan house.
- Catálogo de programas instalados e associação com as máquinas.
- Incidentes, manutenções e custos de reparo.
- Informações do serviço de internet contratado.

### MongoDB — eventos e registros detalhados

Responsável por armazenar documentos relacionados a eventos e atividades, permitindo estruturas flexíveis.

Principais informações:

- Eventos de início e encerramento de sessões.
- Alterações de estado das máquinas.
- Registros detalhados de erros e diagnósticos.
- Eventos de execução de programas.
- Informações complementares sobre ocorrências técnicas.

Os registros de utilização armazenados neste banco poderão referenciar as sessões oficiais registradas no PostgreSQL.

### Apache Cassandra — métricas técnicas

Responsável pelo histórico temporal de informações técnicas coletadas das máquinas.

Principais informações:

- Consumo de CPU, memória RAM e disco.
- Tráfego e condições de conectividade.
- Estado observado das máquinas ao longo do tempo.
- Histórico de processos observados, quando necessário.
- Horário das coletas e da última comunicação de cada máquina.

O Cassandra será utilizado para consultas de histórico técnico organizadas por máquina e período.

## Funcionalidades previstas

- [ ] Cadastro, consulta, atualização e exclusão de máquinas.
- [ ] Consulta do estado operacional das máquinas.
- [ ] Registro e consulta de sessões de utilização.
- [ ] Identificação do último usuário registrado em cada máquina.
- [ ] Consulta do histórico de métricas técnicas.
- [ ] Registro e acompanhamento de incidentes.
- [ ] Registro de manutenções preventivas e corretivas.
- [ ] Consulta dos programas instalados por máquina.
- [ ] Visualização de indicadores de utilização e condições técnicas.

## Tecnologias

As tecnologias serão definidas conforme a implementação do projeto.

| Componente | Tecnologia |
|---|---|
| Frontend | A definir |
| Backend / API REST | A definir |
| Banco relacional | PostgreSQL |
| Banco documental | MongoDB |
| Banco de colunas largas | Apache Cassandra |
| Versionamento | Git e GitHub |

## Regras e decisões de projeto

- O PostgreSQL será a fonte oficial dos cadastros, das sessões e dos registros financeiros.
- O MongoDB armazenará eventos e informações complementares, evitando substituir os registros transacionais oficiais.
- O Cassandra armazenará as métricas técnicas e seus respectivos horários de coleta.
- O estado atual de uma máquina será distinguido de seu histórico de estados.
- A indisponibilidade de um banco deverá ser tratada pelo backend, sem presumir que os dados estejam disponíveis em outra fonte.
- Informações de usuários serão limitadas ao necessário para identificar e registrar as sessões de utilização.
- Não fazem parte do escopo inicial o controle remoto das máquinas, o sistema completo de caixa ou a gestão comercial avançada.

## Perguntas pertinentes ao projeto

- Considerando o teorema CAP, o que pode acontecer quando cada um dos bancos não estiver disponível?
  A indisponibilidade do banco de dados principal POSTGRESQL é a única situação capaz de parar o funcionamento do total do serviço, pois interrompe funcionalidades vitais como <strong>registrar pagamentos, consultar registros  e consultar serviços.</strong>
  Para o MONGODB os impactos são menores, sem interromper completamente o funcionamento. As principais funcionalidades afetadas são <strong>registro detalhado de eventos na máquina, logs de estado da máquina e informações do usuário naquela máquina.</strong>
  O APACHE CASSANDRA tem um menor potencial de impactar o serviço, as funcionalidades que serão desativadas em decorrência de problemas técnicos serão <strong>consultas de consumo de CPU, RAM e desempenho, ultimo usuário e programa executado.</strong>

- Descreva como cada um dos bancos trabalha com o princípio de consistência.
  A escolha de cada um dos bancos é baseado na consistência de cada um. O banco POSTGRESQL trabalha com consistência (C) e disponibilidade de dados (A), vai assegurar informações mais críticas do projeto funcionando como a base principal de registros.
  MONGODB funcionará com o principio de consistência (C) e tolerância ao particionamento (P), contém informações de sessões, detalhes de erros e mudanças de estado da máquina.
  O APACHE CASSANDRA opera com disponibilidade (A) e particionamento (P), a opção de wide-column será usado para informações mais recentes e específicas da máquina.

- Para os bancos não-relacionais que possuem mais do que uma réplica e/ou particionamento, o que ocorre quando uma instância do banco fica indisponível? Quantas instâncias podem ficar indisponível e ainda garantir a consistência dos dados?
  Um Replica Set de três membros no MongoDB será uma estrutura em que manterá três instâncias do MongoDB com os mesmos dados, trabalhando em conjunto. A ideia é que, se uma instância falhar, as outras possam continuar atendendo às operações sem paradas e pode garantir a consistência.
  Primary: recebe as operações de escrita, como inserções, atualizações e exclusões.
  Secondary 1: replica as alterações realizadas no Primary.
  Secondary 2: também replica as alterações realizadas no Primary.
  

## Execução e instalação

As instruções de instalação serão adicionadas após a definição da stack e da estrutura do projeto.

A documentação de execução deverá incluir:

1. Pré-requisitos de instalação.
2. Configuração das variáveis de ambiente.
3. Inicialização dos três bancos de dados.
4. Inicialização do backend e do frontend.
5. Execução das migrações ou scripts de inicialização.
6. Exemplos de requisições à API.
7. Execução dos testes automatizados.

## Contexto acadêmico

Este projeto tem como finalidade aplicar conceitos de desenvolvimento de sistemas, APIs, modelagem de dados e bancos de dados com diferentes modelos de armazenamento.

Também serão estudadas as garantias de consistência, as limitações de disponibilidade e o comportamento da aplicação diante da indisponibilidade de cada banco.

## Status

**Em planejamento e desenvolvimento.**

As funcionalidades e a documentação serão atualizadas conforme a implementação evoluir.

## Integrantes

Rafael Almeida Ferreira (colaborador)
Enrico Nascimento Silva (colaborador)
Guilherme Silva Xavier
