BEGIN;

INSERT INTO maquinas
(id, codigo, nome, grupo, endereco_ip,
 sistema_operacional, processador, memoria_gb,
 armazenamento_gb, status)
VALUES
(1, 'PC-01', 'Estacao 01', 'Gamer',
 '192.168.10.101', 'Windows 11',
 'Intel Core i5-12400F', 16, 512, 'online'),

(2, 'PC-02', 'Estacao 02', 'Gamer',
 '192.168.10.102', 'Windows 11',
 'AMD Ryzen 5 5600', 16, 1000, 'online'),

(3, 'PC-03', 'Estacao 03', 'Basico',
 '192.168.10.103', 'Windows 10',
 'Intel Core i3-10100', 8, 256, 'offline'),

(4, 'PC-04', 'Estacao 04', 'Gamer',
 '192.168.10.104', 'Windows 11',
 'AMD Ryzen 5 5600X', 32, 1000, 'manutencao');


INSERT INTO softwares
(id, nome, versao, categoria, fabricante)
VALUES
(1, 'Google Chrome', '130', 'Navegador', 'Google'),
(2, 'Visual Studio Code', '1.95', 'Desenvolvimento', 'Microsoft'),
(3, 'Steam', 'cliente atual', 'Jogos', 'Valve'),
(4, 'LibreOffice', '24.8', 'Produtividade',
 'The Document Foundation'),
(5, '7-Zip', '24.09', 'Utilitario', 'Igor Pavlov');


INSERT INTO maquina_software
(maquina_id, software_id, instalado_em)
VALUES
(1, 1, CURRENT_DATE - 30),
(1, 2, CURRENT_DATE - 30),
(1, 3, CURRENT_DATE - 30),
(2, 1, CURRENT_DATE - 25),
(2, 3, CURRENT_DATE - 25),
(3, 1, CURRENT_DATE - 20),
(3, 4, CURRENT_DATE - 20),
(4, 1, CURRENT_DATE - 15),
(4, 3, CURRENT_DATE - 15);


-- Historico de utilizacao sem identificacao de usuarios.
INSERT INTO sessoes_uso
(id, maquina_id, inicio, fim)
VALUES
(1, 2,
 NOW() - INTERVAL '2 days 3 hours',
 NOW() - INTERVAL '2 days 1 hour'),

(2, 3,
 NOW() - INTERVAL '1 day 4 hours',
 NOW() - INTERVAL '1 day 3 hours'),

(3, 1,
 NOW() - INTERVAL '35 minutes',
 NULL);


INSERT INTO incidentes
(id, maquina_id, titulo, descricao,
 severidade, status, aberto_em, resolvido_em)
VALUES
(1, 3,
 'Falha de inicializacao',
 'A estacao nao concluiu a inicializacao.',
 'alta', 'aberto',
 NOW() - INTERVAL '3 hours', NULL),

(2, 4,
 'Temperatura elevada',
 'Inspecao do sistema de refrigeracao solicitada.',
 'media', 'em_atendimento',
 NOW() - INTERVAL '1 day', NULL),

(3, 2,
 'Teclado desconectado',
 'Cabo reconectado e funcionamento validado.',
 'baixa', 'resolvido',
 NOW() - INTERVAL '4 days',
 NOW() - INTERVAL '4 days' + INTERVAL '20 minutes');


INSERT INTO manutencoes
(id, maquina_id, incidente_id, descricao,
 tipo, custo, inicio, fim, responsavel_tecnico)
VALUES
(1, 2, 3,
 'Reconexao e teste do teclado',
 'corretiva', 0.00,
 NOW() - INTERVAL '4 days',
 NOW() - INTERVAL '4 days' + INTERVAL '20 minutes',
 'Equipe tecnica'),

(2, 4, 2,
 'Limpeza interna e inspecao de refrigeracao',
 'preventiva', 45.00,
 NOW() - INTERVAL '12 hours',
 NULL,
 'Equipe tecnica');


INSERT INTO contratos_internet
(id, provedor, identificacao, velocidade_mbps,
 valor_mensal, inicio_vigencia, ativo)
VALUES
(1, 'Provedor Exemplo', 'CONTRATO-DEMO-01',
 600, 149.90, CURRENT_DATE - 180, TRUE);


-- Atualizacao das sequencias dos IDs.
SELECT setval(
    pg_get_serial_sequence('maquinas', 'id'),
    (SELECT MAX(id) FROM maquinas)
);

SELECT setval(
    pg_get_serial_sequence('softwares', 'id'),
    (SELECT MAX(id) FROM softwares)
);

SELECT setval(
    pg_get_serial_sequence('sessoes_uso', 'id'),
    (SELECT MAX(id) FROM sessoes_uso)
);

SELECT setval(
    pg_get_serial_sequence('incidentes', 'id'),
    (SELECT MAX(id) FROM incidentes)
);

SELECT setval(
    pg_get_serial_sequence('manutencoes', 'id'),
    (SELECT MAX(id) FROM manutencoes)
);

SELECT setval(
    pg_get_serial_sequence('contratos_internet', 'id'),
    (SELECT MAX(id) FROM contratos_internet)
);


COMMIT;
