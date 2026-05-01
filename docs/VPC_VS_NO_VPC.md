# VPC vs Sin VPC en AWS Lambda

> **TL;DR** — Una VPC es una red privada virtual dentro de AWS. Lambda no
> necesita VPC para conectarse a servicios con endpoint público (DynamoDB,
> S3, APIs externas). Sí la necesita para conectarse a recursos privados
> (Aurora, Redis, servicios internos). En este proyecto usamos VPC *mínima*
> con Aurora pública para eliminar el coste del NAT Gateway.

---

## 1. ¿Qué es una VPC?

Una **VPC (Virtual Private Cloud)** es tu propia red privada dentro de AWS.
Piensa en ella como el edificio donde viven tus servidores: puedes controlar
quién entra, qué puede comunicarse con qué, y qué tiene acceso a internet.

```
Internet
    │
    │  (Internet Gateway — gratuito)
    │
┌───┴─────────────────────────────────────┐
│  VPC  (tu red privada)                  │
│                                         │
│  ┌─────────────┐   ┌─────────────────┐  │
│  │  Subred     │   │  Subred         │  │
│  │  Pública    │   │  Privada/       │  │
│  │             │   │  Aislada        │  │
│  │  Aurora ✓   │   │  Aurora (sin    │  │
│  │  (acceso    │   │   acceso desde  │  │
│  │   público)  │   │   internet)     │  │
│  └─────────────┘   └─────────────────┘  │
└─────────────────────────────────────────┘
```

Recursos que viven **dentro** de la VPC:
- Aurora / RDS (bases de datos)
- ElastiCache (Redis)
- Servicios internos (microservicios privados)

Recursos **fuera** de la VPC (endpoint público de AWS):
- DynamoDB → `dynamodb.eu-west-3.amazonaws.com`
- S3 → `s3.amazonaws.com`
- Cognito, Secrets Manager, SQS, SNS...

---

## 2. Lambda sin VPC (configuración por defecto)

Por defecto, Lambda ejecuta en la **infraestructura gestionada por AWS**,
fuera de tu VPC. Desde ahí puede llamar a cualquier endpoint público:

```
Lambda (sin VPC)
    │
    ├──▶ dynamodb.eu-west-3.amazonaws.com  ✅ (HTTPS público)
    ├──▶ s3.amazonaws.com                  ✅ (HTTPS público)
    ├──▶ api.openai.com                    ✅ (internet)
    └──▶ Aurora privada (IP privada)       ❌ no alcanzable
```

**Ventajas:**
- Sin configuración extra
- Acceso completo a internet
- Sin coste de red adicional
- Cold start más rápido (no hay que crear ENIs en tu VPC)

**Limitaciones:**
- No puede alcanzar recursos privados en tu VPC (Aurora, Redis...)

---

## 3. Lambda con VPC

Cuando añades Lambda a tu VPC, AWS crea una **ENI (Elastic Network
Interface)** en tus subredes. Lambda puede entonces comunicarse con
recursos privados dentro de la VPC.

```
Lambda (dentro de la VPC, subred privada)
    │
    ├──▶ Aurora (IP privada en VPC)        ✅ alcanzable
    ├──▶ Redis (IP privada en VPC)         ✅ alcanzable
    │
    ├──▶ CloudWatch Logs                   ❓ necesita salida a internet
    ├──▶ internet                          ❓ necesita NAT Gateway
    └──▶ DynamoDB, S3...                   ❓ necesita VPC endpoints o NAT
```

Para que Lambda en VPC tenga acceso a internet (CloudWatch Logs,
APIs externas), necesita una de estas dos opciones:

| Opción | Coste | Descripción |
|---|---|---|
| **NAT Gateway** | ~$35/mes | Gateway de salida a internet para subredes privadas |
| **VPC Endpoints** | ~$7/mes por endpoint | Conexión privada a servicios AWS específicos |

**El problema:** Este coste es fijo, independientemente del uso.
Para una aplicación personal con Aurora a 0 ACU (gratis cuando no se usa),
un NAT Gateway cuesta más que la propia base de datos.

---

## 4. El truco: Aurora pública + Lambda fuera de la VPC

Aurora Serverless v2 soporta `publiclyAccessible: true`. Esto hace que
el cluster tenga un **endpoint DNS público** accesible desde internet,
como DynamoDB o cualquier SaaS de base de datos.

```
Internet
    │
    ├──▶ Lambda (sin VPC)
    │        │
    │        │  TCP 5432 (con contraseña y SSL)
    │        ▼
    │    recipe-manager-aurora-cluster.cluster-xxxx.eu-west-3.rds.amazonaws.com
    │        │
    │        ▼ (Internet Gateway)
    └────▶ VPC → Subred pública → Aurora
```

Aurora sigue dentro de la VPC (AWS lo exige), pero acepta conexiones
desde el exterior. El Security Group controla el acceso: puerto 5432
abierto a `0.0.0.0/0`, protegido únicamente por la contraseña.

**Resultado:** Lambda se conecta a Aurora igual que se conectaba a
DynamoDB: sin VPC, sin NAT, sin coste fijo.

---

## 5. Comparativa de opciones para este proyecto

| Configuración | Coste fijo/mes | Seguridad | Complejidad |
|---|---|---|---|
| DynamoDB (era anterior) | $0 | Alta (IAM) | Baja |
| Aurora privada + NAT Gateway | ~$35 | Alta | Media |
| Aurora privada + VPC Endpoints | ~$7-14 | Alta | Media |
| **Aurora pública + Lambda sin VPC** | **$0** | Media* | **Baja** |
| Neon/Supabase (externo) | $0 (free tier) | Media | Baja |

*\*Media porque el endpoint es público. Mitigado por contraseña de 32 chars y SSL.*

---

## 6. ¿Cuáles son los riesgos de Aurora pública?

### Riesgo 1: Endpoint descubierto + ataque de fuerza bruta

Alguien podría descubrir el hostname de Aurora (p. ej., en logs, en un
error de la app) e intentar conectarse.

**Mitigación:**
- Contraseña de 32 caracteres alfanuméricos auto-generada (Secrets Manager)
- Aurora bloquea conexiones fallidas (rate limiting interno)
- SSL obligatorio por defecto en Aurora PostgreSQL

**Realidad:** Con una contraseña así, un ataque de fuerza bruta tardaría
miles de millones de años.

### Riesgo 2: Filtración de credenciales

Si alguien obtiene `POSTGRES_PASSWORD` (p. ej., de un log de Lambda),
puede conectarse directamente.

**Mitigación en este proyecto:**
- Las credenciales se inyectan como variables de entorno en Lambda
- Lambda env vars están cifradas en reposo (AWS KMS)
- CloudWatch Logs no loguea variables de entorno

**Para producción real:** Rotar credenciales periódicamente con
Secrets Manager rotation. Aquí no lo implementamos (proyecto personal).

### Riesgo 3: Sin auditoría de conexiones

En una VPC privada puedes añadir VPC Flow Logs para ver quién se conecta.
Con Aurora pública, las conexiones vienen de múltiples IPs de Lambda
(AWS no garantiza IPs fijas para Lambda sin VPC).

**Mitigación:** Aurora tiene logs de conexiones en PostgreSQL (`pg_log`).
Se pueden activar con `log_connections = on` en los parámetros del cluster.

---

## 7. ¿Cuándo SÍ usar VPC privada?

Usa Aurora privada (con NAT o VPC Endpoints) cuando:

- **Datos sensibles** (médicos, financieros, legales) — regulaciones HIPAA/PCI-DSS exigen red privada
- **Auditoría estricta** — necesitas VPC Flow Logs de todas las conexiones
- **Múltiples servicios internos** — ya tienes NAT Gateway por otros motivos (el coste se amortiza)
- **Proyecto en producción con usuarios reales** — el riesgo de exposición pública no es aceptable
- **Compliance corporativo** — la empresa exige que las BDs no tengan endpoint público

Para un proyecto personal como este (recetas de cocina), Aurora pública
es una decisión técnica correcta y pragmática.

---

## 8. Arquitectura actual de este proyecto

```
GitHub  ──▶  GitHub Actions  ──▶  cdk deploy
                                       │
                    ┌──────────────────┼──────────────────┐
                    │                  │                   │
              VpcStack           AuroraStack        LambdaApiStack
              (VPC mínima)       (Aurora pública)   (Lambda sin VPC)
                    │                  │                   │
                    │    Internet      │                   │
                    │    Gateway       │                   │
                    │       │          │                   │
              ┌─────┴───────┴──────────┴─────────────┐    │
              │  VPC  recipe-manager-vpc              │    │
              │                                       │    │
              │  Subred pública                       │    │
              │  ┌─────────────────────────────────┐  │    │
              │  │  Aurora Serverless v2            │◀─┼────┘
              │  │  (publiclyAccessible: true)      │  │  TCP 5432
              │  │  0 ACU mínimo = gratis en reposo │  │
              │  └─────────────────────────────────┘  │
              └───────────────────────────────────────┘

Usuario  ──▶  Amplify (frontend)
                  │
                  ▼  HTTPS + JWT
             API Gateway  ──▶  Lambda  ──▶  Aurora
                                (sin VPC)   (pública)
```

**Coste total cuando no hay tráfico: $0/mes.**

---

## 9. ¿Y si en el futuro crece el proyecto?

Si el proyecto crece y necesita más seguridad:

1. Cambiar `publiclyAccessible: false` en `aurora-stack.ts`
2. Mover Aurora a subredes privadas/aisladas
3. Mover Lambda a subredes privadas
4. Añadir NAT Gateway (o VPC Endpoints si el coste importa)
5. Actualizar el Security Group de Aurora para permitir solo el SG de Lambda

La arquitectura CDK está preparada para este cambio: todo está en
`vpc-stack.ts` y `aurora-stack.ts`, sin dependencias cruzadas con el
resto de la infraestructura.

---

## Referencias

- [AWS — Lambda in VPC](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html)
- [AWS — Aurora publicly accessible](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.CreateInstance.html)
- [AWS — NAT Gateway pricing](https://aws.amazon.com/vpc/pricing/)
- [AWS — VPC Endpoints pricing](https://aws.amazon.com/privatelink/pricing/)
