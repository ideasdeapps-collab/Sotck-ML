# 🐛 FIX — La curva MLP colapsaba a $0 (caso SNDK)

## El problema
La predicción MLP de SNDK caía a $0 en pocos días:
`$1214 → $780 → $457 → $81 → $0.94 → $0.00`
Con métricas: **R² = -3.64** (peor que la media) y **Dir.Acc = 44%**.

## La causa (dos factores)
1. **Las redes neuronales extrapolan sin límite** fuera del rango de entrenamiento.
   En la predicción recursiva, un retorno negativo genera features cada vez más
   extremas → retornos aún más negativos → espiral hacia $0.
   (XGBoost, al ser árboles, satura y NO sufre esto — por eso su curva no colapsa.)
2. **SNDK es ultra-volátil** (de $583 a $2335 y de vuelta a $1015 en meses): el
   modelo MLP no generaliza en ese caos, de ahí el R² negativo.

## La solución (2 capas)
### `api/mlp.py` — REEMPLAZAR
- **CLAMP**: cada retorno log diario se acota a ±3.5·σ (σ = volatilidad diaria
  histórica del ticker). Impide la explosión/implosión recursiva.
- **RELIABILITY**: el endpoint ahora devuelve un bloque `reliability`:
  ```json
  "reliability": {"reliable": false, "r2": -3.64,
                  "directional_accuracy": 0.44,
                  "warning": "R² negativo (-3.64): peor que predecir la media. ..."}
  ```

### `app/StockForecastChart.tsx` — REEMPLAZAR
- Si el modelo MLP es **no confiable** (R²<0 o dir.acc<50%), la curva verde
  **se oculta** y se muestra una **advertencia clara** en vez de pintar una curva
  engañosa. Si es confiable, se pinta normal.

## Deploy
```bash
git add api/mlp.py app/StockForecastChart.tsx
git commit -m "fix: clamp anti-colapso MLP + advertencia de modelos no confiables"
git push
```
Verifica en `/predict-mlp?ticker=SNDK` que ahora el bloque `reliability.reliable`
sea `false` y que la curva ya no llegue a $0.

## Importante sobre SNDK
Aun con el clamp, **el modelo MLP de SNDK sigue siendo malo** (R²=-3.64). El clamp
evita el absurdo de $0, pero la curva no es confiable. Opciones:
- **Confía en XGBoost** para SNDK (los árboles son más robustos en tickers volátiles).
- **Reentrena** el MLP de SNDK (a veces mejora con otra semilla / más regularización),
  aunque los stocks ultra-volátiles son intrínsecamente difíciles de predecir.
- La app ahora **te avisa** cuando un modelo no es confiable, para que no lo uses a ciegas.
