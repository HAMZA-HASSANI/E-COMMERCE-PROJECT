# Environment Variables Configuration

## Database Configuration
- `DB_USER`: PostgreSQL username (default: postgres)
- `DB_PASSWORD`: PostgreSQL password (default: postgres)
- `DB_HOST`: PostgreSQL host (default: postgres in Docker, localhost for local)
- `DB_PORT`: PostgreSQL port (default: 5432)
- `DB_NAME`: Database name (default: ecommerce)

## Authentication
- `JWT_SECRET`: Secret key for JWT tokens (change in production!)

## Message Queue
- `RABBITMQ_USER`: RabbitMQ username (default: guest)
- `RABBITMQ_PASSWORD`: RabbitMQ password (default: guest)
- `RABBITMQ_URL`: RabbitMQ connection string

## Email/SMTP
- `SMTP_HOST`: SMTP server host (default: mailhog for testing)
- `SMTP_PORT`: SMTP server port (default: 1025 for mailhog)
- `SMTP_USER`: SMTP username (optional)
- `SMTP_PASSWORD`: SMTP password (optional)

## Service URLs
- `PRODUCT_SERVICE_URL`: Product service endpoint
- `USER_SERVICE_URL`: User service endpoint
- `ORDER_SERVICE_URL`: Order service endpoint

## Environment
- `NODE_ENV`: Environment (development, production)

## Security Notes

⚠️ **IMPORTANT**: 
- Change `JWT_SECRET` in production
- Use strong database passwords
- Never commit `.env` file to version control
- Rotate passwords regularly in production
- Use managed secrets service (Vault, AWS Secrets Manager, etc.)

## Kubernetes Secrets

Secrets are managed via `kubernetes/00-namespace-config.yaml`. Update the `stringData` section for Kubernetes deployments.

## Local Development

Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

Then run:
```bash
docker-compose up -d
```

## Production Deployment

1. Update all credentials in `.env`
2. Use Kubernetes Secrets instead of .env files
3. Enable TLS/SSL for all connections
4. Use environment-specific configurations
5. Implement proper backup strategy
