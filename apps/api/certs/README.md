# Certificados de CA

Certificados **públicos** de autoridades certificadoras, para verificar de
verdad con quién habla la base de datos. No hay nada secreto acá: una CA es
pública por definición, y versionarla evita toda una clase de fallo de
despliegue.

| Archivo | Para qué |
| --- | --- |
| `supabase-prod-ca.crt` | Supabase. Su cadena está firmada por su propia CA, así que sin esto Node rechaza la conexión con `self-signed certificate in certificate chain`. |

Se usa con `DATABASE_CA_CERT`, que acepta una ruta o el PEM completo:

```
DATABASE_CA_CERT=./certs/supabase-prod-ca.crt
```

La alternativa es `DATABASE_SSL=no-verify`, que cifra pero no comprueba nada:
deja la puerta abierta a un intermediario activo. Sirve para salir del paso.
