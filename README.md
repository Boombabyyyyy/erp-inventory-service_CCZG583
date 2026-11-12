# ERP Inventory Service

This is part of an ERP system that was split into microservices (CCZG583 Scalable Services assignment).
The service owns the **product master** and **stock levels**. It has its own PostgreSQL database.

- **Tech:** Node.js 22, Express 4, PostgreSQL 16 (`pg` driver)
- **Port:** 3001
- **Consumers:** the Sales Order Service calls `/reserve` and `/release`

## API

| Method | Path | Type | Description |
|---|---|---|---|
| GET | `/health` | Query | Liveness/readiness check, including the DB |
| GET | `/products?category=` | Query | List products |
| GET | `/products/:id` | Query | Get one product |
| GET | `/products/:id/availability?qty=` | Query | Check whether a quantity is available |
| POST | `/products` | Command | Create a product `{sku,name,category,uom,unit_price,stock}` |
| PATCH | `/products/:id/stock` | Command | Adjust stock `{delta}` (goods receipt or write-off) |
| POST | `/products/:id/reserve` | Command | Reserve stock for an order `{quantity}`. Atomic. Returns 409 if stock is short |
| POST | `/products/:id/release` | Command | Release reserved stock `{quantity}` |

## Project structure

```
erp-inventory-service/
├── src/
│   ├── index.js        # Express app and routes
│   └── db.js           # PG pool, schema creation, seed data
├── k8s/
│   ├── 00-namespace.yaml
│   ├── 01-postgres.yaml   # Secret, PVC, Postgres Deployment and Service
│   ├── 02-configmap.yaml
│   ├── 03-deployment.yaml # 2 replicas, readiness/liveness probes
│   └── 04-service.yaml    # NodePort 30001
├── .github/workflows/ci.yml
├── Dockerfile
└── package.json
```

## Run locally

```bash
docker run -d --name inv-db -e POSTGRES_USER=inventory -e POSTGRES_PASSWORD=inventory -e POSTGRES_DB=inventorydb -p 5432:5432 postgres:16-alpine
npm install
npm start
```

## Run on minikube

```bash
eval $(minikube docker-env)
docker build -t inventory-service:1.0.0 .
kubectl apply -f k8s/
kubectl -n erp get pods
minikube service inventory-service -n erp --url
```
