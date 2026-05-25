# API Gateway vs NAT Gateway vs Load Balancers vs Proxies

> **TL;DR** — Son todos "intermediarios" en una red, pero resuelven problemas
> opuestos. **API Gateway** es la puerta de **entrada** (clientes → tu app).
> **NAT Gateway** es la puerta de **salida** (tu app privada → internet).
> Los **Load Balancers** reparten tráfico entrante entre varios destinos.
> Los **Proxies** (forward/reverse/RDS Proxy) median conexiones por razones
> de control, caché, o pooling. Conocer la dirección del tráfico y la
> motivación de cada uno evita confundirlos.

---

## 1. Dirección del tráfico: el criterio principal

La forma más rápida de diferenciarlos es preguntar **¿quién inicia la conexión?**

```
            ENTRADA (inbound)                     SALIDA (outbound)
       cliente externo → tu app              tu app privada → internet
       ─────────────────────────             ─────────────────────────
        • API Gateway                         • NAT Gateway
        • Load Balancer (ALB/NLB)             • Forward Proxy
        • CloudFront (CDN)                    • VPC Endpoints (alternativa
        • Reverse Proxy (nginx)                 privada al NAT para AWS)
```

Hay un caso especial — **RDS Proxy** — que no encaja en ninguna columna:
es un proxy **interno** entre tu compute y tu base de datos, ambos
dentro de la VPC. No ve tráfico de internet.

---

## 2. API Gateway

### Qué es

Un servicio gestionado de AWS que **expone tu backend a internet** como una
API HTTP/REST/WebSocket. Recibe peticiones, las valida, las autentica, y
las reenvía a tu Lambda, ECS, EC2 o servicio externo.

```
Cliente (browser, móvil, curl)
    │
    │  HTTPS  https://api.miapp.com/recipes
    ▼
┌─────────────────────────────────────────┐
│  API Gateway                            │
│  • TLS termination                      │
│  • Autenticación (Cognito, IAM, JWT)    │
│  • Rate limiting / throttling           │
│  • Validación de request                │
│  • Mapping de rutas                     │
└─────────────────────────────────────────┘
    │
    ▼
Lambda  /  ECS task  /  HTTP backend
```

### Para qué se usa

- **Exponer Lambda públicamente** — Lambda no tiene URL pública por defecto;
  API Gateway le da una
- **Autenticación centralizada** — Cognito, JWT, API keys, IAM, sin tocar
  el código de cada handler
- **Rate limiting** — proteger el backend de abuso o picos
- **Versionado de API** — `/v1/recipes`, `/v2/recipes` con stages
- **Transformaciones request/response** — adaptar formatos sin modificar
  el backend

### Variantes

| Tipo | Casos de uso | Coste aprox. |
|---|---|---|
| **HTTP API** (v2) | REST simple, JWT, low cost | $1.00 / millón de peticiones |
| **REST API** (v1) | Features avanzadas (caché, validación, WAF) | $3.50 / millón |
| **WebSocket API** | Conexiones bidireccionales persistentes | $1.00 / millón + horas conectado |

### Lo que **no** es

- **No es un Load Balancer** — aunque puede repartir entre stages o targets,
  no es su función principal. Para HTTP de bajo nivel con múltiples backends
  EC2, usa ALB.
- **No es para tráfico de salida** — no tiene nada que ver con cómo tu Lambda
  llama a APIs externas.
- **No es siempre obligatorio** — Lambda Function URLs (desde 2022) permiten
  exponer una Lambda sin API Gateway, pero sin autenticación avanzada ni
  rate limiting.

---

## 3. NAT Gateway

### Qué es

Un servicio gestionado de AWS que permite a **recursos en subredes privadas
salir a internet** sin recibir conexiones entrantes. Hace **Network Address
Translation** — traduce las IPs privadas de tus recursos a una IP pública
única.

```
┌─────────────────────────────────────────────────────┐
│  VPC                                                │
│  ┌─────────────────────┐                            │
│  │  Subred privada     │                            │
│  │  ┌───────────────┐  │                            │
│  │  │  Lambda /     │  │                            │
│  │  │  ECS / EC2    │  │                            │
│  │  │  (IP privada) │  │                            │
│  │  └───────┬───────┘  │                            │
│  └─────────┼───────────┘                            │
│            │                                        │
│            ▼  (traduce IP privada → IP pública)     │
│  ┌─────────────────────┐                            │
│  │  Subred pública     │                            │
│  │  ┌───────────────┐  │                            │
│  │  │  NAT Gateway  │  │                            │
│  │  │  (IP elástica)│  │                            │
│  │  └───────┬───────┘  │                            │
│  └─────────┼───────────┘                            │
│            │                                        │
│            ▼  Internet Gateway                      │
└────────────┼────────────────────────────────────────┘
             │
             ▼
         Internet (CloudWatch, APIs externas, S3...)
```

### Para qué se usa

- **Lambda dentro de VPC** que necesita llamar a APIs externas (OpenAI,
  Stripe, etc.) o a CloudWatch Logs
- **ECS/Fargate en subred privada** que necesita salir a internet (pull de
  imágenes Docker, llamadas a APIs)
- **Cualquier recurso privado** que necesite descargar paquetes, actualizar
  dependencias, etc.

### Características clave

| Característica | Detalle |
|---|---|
| Dirección permitida | **Sólo saliente** — internet no puede iniciar conexiones hacia dentro |
| Coste fijo | ~$35/mes por NAT Gateway (por AZ) |
| Coste variable | $0.045/GB de datos procesados |
| Alta disponibilidad | Uno por AZ si quieres redundancia |
| Alternativa más barata | **VPC Endpoints** (~$7/mes) si sólo necesitas acceder a servicios AWS |

### Confusión común

Mucha gente confunde NAT Gateway con Internet Gateway:

- **Internet Gateway** — gratis, sólo conecta la VPC al internet. Sin él,
  ni recursos públicos ni NAT funcionan. Es el "router de borde" de la VPC.
- **NAT Gateway** — de pago, traduce direcciones. Permite que recursos
  **sin IP pública** salgan a internet.

Ver [[vpc-vs-no-vpc]] para por qué este proyecto evita el NAT Gateway.

---

## 4. Load Balancers (ALB, NLB, GLB)

### Qué son

Un Load Balancer **reparte tráfico entrante entre varios destinos** (EC2,
ECS, Lambda, IPs). Los clientes ven una sola URL/IP; el LB decide qué
backend atiende cada petición.

```
Cliente
    │
    ▼
┌─────────────────────────┐
│  Load Balancer          │
│  (1 IP / 1 DNS)         │
└──┬────────┬────────┬────┘
   │        │        │
   ▼        ▼        ▼
 EC2-1    EC2-2    EC2-3   (o ECS tasks, o Lambdas)
```

### Tipos en AWS

| Tipo | Capa OSI | Para qué sirve | Cuándo usarlo |
|---|---|---|---|
| **ALB** (Application LB) | L7 (HTTP/HTTPS) | Routing por path, host, headers, cookies | APIs web, microservicios, ECS/Fargate |
| **NLB** (Network LB) | L4 (TCP/UDP) | Latencia muy baja, millones de conexiones | TCP raw, gRPC, juegos, VoIP |
| **GLB** (Gateway LB) | L3 | Distribuir tráfico entre firewalls/IDS | Appliances de seguridad de terceros |
| **CLB** (Classic, legado) | L4/L7 | Sólo para cuentas viejas | No usar en infraestructura nueva |

### ALB vs API Gateway

Esta es la confusión más frecuente. Ambos exponen HTTP. Diferencias clave:

| | ALB | API Gateway |
|---|---|---|
| Modelo de coste | Hora + LCU | Por petición |
| Mejor para... | ECS/EC2 (workloads persistentes) | Lambda (workloads serverless) |
| Auth nativa | Cognito, OIDC | Cognito, IAM, JWT, Lambda authorizer |
| Throttling | No (necesita WAF) | Sí, nativo |
| Caché | No | Sí (REST API) |
| Coste a tráfico cero | ~$16/mes (hora fija) | $0 |
| Coste a alto tráfico | Mucho más barato | Mucho más caro |

Regla práctica:
- **Lambda → API Gateway** (paga sólo por petición)
- **ECS/EC2 → ALB** (ya pagas el compute 24/7)
- **gRPC o TCP no-HTTP → NLB**

### Lo que **no** son

- **No son puertas de salida** — sólo gestionan tráfico entrante
- **No son routers de internet** — necesitan estar dentro de una VPC con
  Internet Gateway (si es público) o conectados al cliente vía VPN

---

## 5. Proxies (reverse, forward, RDS Proxy)

"Proxy" es un término genérico para **cualquier intermediario que media
una conexión**. En AWS y en redes en general hay varias variantes con
papeles muy distintos.

### Reverse Proxy

Está **delante del backend**. El cliente cree que habla con el proxy; el
proxy habla con los servidores reales por detrás.

```
Cliente  →  Reverse Proxy (nginx, ALB, CloudFront)  →  Backend
```

Casos de uso:
- TLS termination
- Caché de respuestas estáticas
- Compresión, rewriting
- Servir múltiples apps bajo un mismo dominio

**API Gateway y ALB son reverse proxies gestionados**, especializados.
Si self-hosteas en EC2, usas nginx, Caddy o Traefik.

### Forward Proxy

Está **delante del cliente**. El servidor de destino cree que habla con
el proxy; el proxy esconde al cliente real.

```
Cliente  →  Forward Proxy (corporate proxy, Squid)  →  Internet
```

Casos de uso:
- Filtrar tráfico saliente en redes corporativas
- Caché compartido para descargas
- Anonimato (VPNs son una forma de forward proxy)

En AWS no es común — el **NAT Gateway** cubre la mayor parte de los casos
(sale a internet sin exponer IPs internas), pero técnicamente NAT ≠ proxy:
NAT opera en L3 (IPs), un proxy opera en L7 (HTTP) y puede inspeccionar
contenido.

### RDS Proxy

Un proxy especializado de AWS **entre tu compute y tu base de datos**.
Mantiene un pool de conexiones a la DB y las multiplexa entre muchos
clientes.

```
Lambda × N invocaciones
    │
    ▼
RDS Proxy (mantiene pool de conexiones a la DB)
    │
    ▼
Aurora / RDS
```

Resuelve el problema clásico de "1000 Lambdas concurrentes = 1000
conexiones a la DB" (que agotan el límite). Ver
[[aws-sql-db-networking]] para el análisis completo.

| | RDS Proxy |
|---|---|
| Capa | L4 (TCP, protocolo PostgreSQL/MySQL) |
| Dirección | Interno a la VPC (no internet) |
| Cuándo usarlo | Lambda de alta concurrencia con SQL |
| Coste | ~$22/mes (2 vCPUs mínimas) |

---

## 6. Flujo completo: cómo encaja todo

Ejemplo de una arquitectura típica donde aparecen todos:

```
Usuario
   │
   │  HTTPS
   ▼
┌──────────────────┐
│  CloudFront      │  ← CDN / reverse proxy global (caché, TLS)
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  API Gateway     │  ← entrada principal a la API (auth, throttling)
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Lambda          │  ← lógica de negocio (en VPC privada)
└────────┬─────────┘
         │
    ┌────┴─────┐
    │          │
    ▼          ▼
┌─────────┐  ┌──────────────┐
│ RDS     │  │ NAT Gateway  │  ← salida a internet
│ Proxy   │  └──────┬───────┘     (CloudWatch Logs, APIs externas)
└────┬────┘         │
     ▼              ▼
┌─────────┐    Internet (Stripe, OpenAI, etc.)
│ Aurora  │
└─────────┘
```

Cada flecha es un componente con un papel distinto. Confundirlos lleva a
arquitecturas mal dimensionadas (p. ej., poner un ALB delante de una
Lambda para una API que ve 100 req/día — pagas $16/mes fijos cuando
API Gateway te habría costado $0.0001).

---

## 7. Tabla comparativa rápida

| Componente | Dirección | Capa | Coste a tráfico cero | Para qué |
|---|---|---|---|---|
| **API Gateway** | Entrada | L7 (HTTP) | $0 | Exponer Lambda/HTTP backends |
| **ALB** | Entrada | L7 (HTTP) | ~$16/mes | Repartir HTTP entre ECS/EC2 |
| **NLB** | Entrada | L4 (TCP/UDP) | ~$16/mes | TCP/UDP de baja latencia |
| **CloudFront** | Entrada | L7 (HTTP) | $0 | CDN global, caché de borde |
| **NAT Gateway** | Salida | L3 (IP) | ~$35/mes | Salida a internet desde subred privada |
| **VPC Endpoints** | Salida (a AWS) | L4 | ~$7/mes | Acceso privado a servicios AWS |
| **Internet Gateway** | Ambas | L3 | $0 | Router de borde de la VPC |
| **RDS Proxy** | Interno | L4 (SQL) | ~$22/mes | Pool de conexiones a DB |
| **Reverse Proxy (nginx)** | Entrada | L7 | (depende del host) | Self-hosted gateway/caché |
| **Forward Proxy (Squid)** | Salida | L7 | (depende del host) | Filtrado de tráfico saliente |

---

## 8. Reglas mentales para no confundirlos

1. **"Gateway" en AWS no es un nombre genérico.** API Gateway, NAT Gateway,
   Internet Gateway, VPC Gateway... cada uno es un servicio distinto con
   un propósito muy específico. Lee siempre el nombre completo.

2. **Si el cliente está fuera, piensa en "entrada".** API Gateway, ALB,
   CloudFront. Si tu app está dentro y quiere salir, piensa en "salida":
   NAT, VPC Endpoint, Forward Proxy.

3. **Lambda + HTTP público = API Gateway.** No ALB. (Técnicamente ALB
   también soporta Lambda como target, pero rara vez merece la pena.)

4. **ECS/EC2 + HTTP público = ALB.** Aunque API Gateway funcionaría,
   pagar por petición sobre un workload 24/7 es caro.

5. **Si oyes "proxy" sin más contexto, pregunta cuál.** Reverse proxy,
   forward proxy, y RDS Proxy hacen cosas totalmente distintas.

6. **NAT Gateway es caro y a menudo evitable.** Si tu Lambda no necesita
   estar en VPC (porque su DB es pública o usa DynamoDB), te ahorras
   los $35/mes. Ver [[vpc-vs-no-vpc]].

---

## Referencias

- [AWS — Amazon API Gateway](https://docs.aws.amazon.com/apigateway/)
- [AWS — NAT Gateways](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-nat-gateway.html)
- [AWS — Elastic Load Balancing](https://docs.aws.amazon.com/elasticloadbalancing/)
- [AWS — RDS Proxy](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy.html)
- [AWS — VPC Endpoints](https://docs.aws.amazon.com/vpc/latest/privatelink/vpc-endpoints.html)
- [AWS — CloudFront](https://docs.aws.amazon.com/cloudfront/)
