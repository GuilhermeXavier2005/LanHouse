# LanHouse Monitor

Sistema de gerenciamento e monitoramento de computadores para lan houses, desenvolvido como projeto acadêmico com foco em APIs, bancos de dados e sistemas distribuídos.

## Sobre o projeto

O **LanHouse Monitor** tem como objetivo centralizar o gerenciamento das máquinas de uma lan house, permitindo acompanhar suas condições técnicas, registrar sessões de utilização e organizar informações sobre manutenção e serviços oferecidos.

A proposta é facilitar a identificação de computadores indisponíveis, problemas recorrentes e utilização dos recursos, fornecendo ao responsável uma visão geral do ambiente em uma única aplicação.

O projeto também busca explorar o uso de diferentes modelos de bancos de dados, aplicando cada tecnologia a um tipo de informação específico.

## Objetivos

- Gerenciar o cadastro e as informações técnicas dos computadores.
- Acompanhar o estado das máquinas e o consumo de recursos.
- Registrar sessões de utilização, incluindo máquina, usuário, duração e valor pago.
- Manter registros de manutenção e incidentes técnicos.
- Consultar o histórico de métricas e eventos das máquinas.
- Aplicar operações CRUD por meio de uma API.
- Estudar consistência, disponibilidade e limitações de diferentes bancos de dados.

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
                      |        |
              +-------+---+    +----------------+
              |           |                     |
              v           v                     v
        +-----------+ +-----------+     +----------------+
        | PostgreSQL| |  MongoDB  |     |   Cassandra    |
        |   RDB     | |   DB1     |     |      DB2       |
        +-----------+ +-----------+     +----------------+
```

A arquitetura utiliza uma instância de cada banco de dados, sem réplicas ou particionamento distribuído.

## Bancos de dados

### PostgreSQL — dados relacionais

Responsável pelos dados cadastrais e transacionais que exigem relacionamentos e integridade.

Principais informações:

- Cadastro das máquinas e suas especificações.
- Cadastro básico de usuários.
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
- [ ] Testes das operações da API e do comportamento diante de falhas nos bancos.

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

## Licença

A licença do projeto será definida pelos integrantes do grupo.
