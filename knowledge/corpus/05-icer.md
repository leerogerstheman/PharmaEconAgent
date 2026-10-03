---
id: icer-metrics
topic: icer
title: ICER、INMB 与成本效果平面
type: formula
level: beginner
tags: [ICER, INMB, NMBA, 成本效果平面, 净货币效益, 增量分析]
aliases: [ICER, INMB, NMB, NMBA, 增量成本效果比, 成本效果平面, CE plane]
source: Drummond et al. Methods for the Economic Evaluation of Health Care Programmes; Wikipedia Pharmacoeconomics
url: https://en.wikipedia.org/wiki/Pharmacoeconomics
year: 2020
---

## ICER 增量成本效果比

```
ICER = ( C₁ − C₀ ) / ( E₁ − E₀ ) = ΔC / ΔE
```

- `C₀, E₀` = **对照方案（comparator）** 的成本与效果
- `C₁, E₁` = **干预方案（intervention）** 的成本与效果
- 单位：元 / QALY（或元 / LYG 等）

**ICER 衡量的是"多花的每一单位效果值多少钱"**，它是一个比值，不是总花费。

### 算例

| 方案 | 成本（元） | QALY |
| --- | --- | --- |
| 对照 A | 100,000 | 3.00 |
| 干预 B | 160,000 | 3.40 |

```
ICER = (160000 − 100000) / (3.40 − 3.00) = 60000 / 0.40 = 150,000 元/QALY
```

含义：**为了多获得 1 个 QALY，需要多花 15 万元**。把它和阈值（如 5 万、10 万元/QALY）比一比就知道值不值。

### ICER 无解的情况

若 `ΔE = 0`，ICER **没有定义**（除以 0）。这时应：

- 若成本也不同 → 不适合用 ICER，改用 **成本-后果分析** 或直接比较平面位置
- 若成本也不同且效果确实相同 → 用 **CMA**

## INMB 增量净货币效益

```
INMB = ΔC − λ × ΔE
```

`λ`（lambda）是**阈值**，表示决策者愿意为 1 个 QALY 支付的最大金额。

- `INMB > 0` → 在该阈值下，新方案更值得采用
- `INMB < 0` → 不值得

**INMB 的最大优势：可以放进概率敏感性分析里做平均**，而 ICER 不能（对模拟结果求平均是统计学错误）。

算例（承上，λ = 100000）：

```
INMB = 60000 − 100000 × 0.40 = 60000 − 40000 = +20,000
```

结论：阈值定在 10 万元/QALY 时，新方案有 2 万元的"净赚"空间。

## 成本效果平面（CE Plane）

把两个方案的差异画成一点（ΔC, ΔE），分成四象限：

| 象限 | Δ效果 | Δ成本 | 含义与处理 |
| --- | --- | --- | --- |
| **NE**（东北） | > 0 | < 0 | **效果更好且更便宜**，强优势（dominant）→ 直接采用 |
| **NE-** | > 0 | > 0 | 效果更好但更贵 → **看 ICER 是否低于阈值** |
| **SW** | < 0 | < 0 | 效果更差也更便宜 → 权衡是否值得为省钱牺牲效果 |
| **SW-**（西南） | < 0 | > 0 | **更差且更贵**，被完全支配（dominated）→ 放弃该方案 |

> **学生最常见的错误**：只看 ICER 数值，忘了先看平面位置。如果新方案在西南象限，ICER 再"好看"也不能采用。

## 支配关系速查

- **强支配（strong dominance）**：效果 ↑ 且成本 ↓ → 采用新方案，无需算 ICER
- **弱支配（weak dominance / extended dominance）**：存在另一方案效果不低、成本不高 → 被支配方案应剔除
- **无支配**：进入 ICER 计算

## 三个指标的关系

| 指标 | 形式 | 能否进 PSA 求平均 | 用途 |
| --- | --- | --- | --- |
| ICER | 比值 | ❌ 不能（统计错误） | 确定性分析的总结论 |
| NMBA / INMB 均值 | 差值 | ✅ 可以 | PSA 主要结果 |
| 可接受概率 | 概率 | ✅ 可以 | 报告口径，与阈值对应 |

**主流报告规范（CHEERS 2022）要求报告可接受概率，而不是只报 ICER。**
