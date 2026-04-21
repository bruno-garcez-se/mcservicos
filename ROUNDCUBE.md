# Roundcube no projeto

## 1) Copiar variáveis

Copie o arquivo de exemplo:

```bash
cp .env.roundcube.example .env.roundcube
```

## 2) Subir containers

```bash
docker compose --env-file .env.roundcube -f docker-compose.roundcube.yml up -d
```

## 3) URL padrão

- Roundcube: `http://localhost:8088`

## 4) Configurar no sistema

No portal (admin), abra:

- `Configuração` -> `Configuração do Roundcube`

Informe:

- URL do Roundcube
- SMTP host/porta
- IMAP host/porta
- login e senha

Depois acesse a aba `Roundcube` e use `Entrar no Roundcube`.
# Roundcube no projeto

## 1) Copiar variáveis

Copie o arquivo de exemplo:

```bash
cp .env.roundcube.example .env.roundcube
```

## 2) Subir containers

```bash
docker compose --env-file .env.roundcube -f docker-compose.roundcube.yml up -d
```

## 3) URL padrão

- Roundcube: `http://localhost:8088`

## 4) Configurar no sistema

No portal (admin), abra:

- `Configuração` -> `Configuração do Roundcube`

Informe:

- URL do Roundcube
- SMTP host/porta
- IMAP host/porta
- login e senha

Depois acesse a aba `Roundcube` e use `Entrar no Roundcube`.
