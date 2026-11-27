"""Render the original battle effects as mono 32 kHz PCM WAV (NumPy + SciPy)."""

import argparse
from pathlib import Path
import wave

import numpy as np
from scipy.signal import butter, fftconvolve, sosfilt

RATE = 32000


class Sound:
    def __init__(self, seconds, seed):
        self.rng = np.random.default_rng(seed)
        self.samples = np.zeros(round(seconds * RATE))
        self.t = np.arange(len(self.samples)) / RATE

    def envelope(self, attack, decay):
        transient = np.minimum(self.t / attack, 1)
        return transient * np.exp(-self.t / decay)

    def band(self, low, high, white=None):
        white = self.rng.standard_normal(len(self.t)) if white is None else white
        shaped = sosfilt(butter(2, (low, high), btype='bandpass', fs=RATE, output='sos'), white)
        return shaped / max(np.std(shaped), 1e-8)

    def add(self, signal, level=1, at=0):
        start = round(at * RATE)
        count = min(len(signal), len(self.samples) - start)
        if count > 0:
            self.samples[start:start + count] += signal[:count] * level

    def sweep(self, start, end, seconds, drive=0):
        frequency = start * np.power(end / start, np.minimum(self.t / seconds, 1))
        phase = np.cumsum(frequency) * (2 * np.pi / RATE)
        sine = np.sin(phase)
        return np.tanh(sine + drive * np.sin(phase * 2.03)) if drive else sine

    def air(self, low, high, decay, level, at=0, attack=.028, lift=False):
        white = self.rng.standard_normal(len(self.t))
        rough = self.band(low, high, white)
        bright = self.band(low * 1.85, min(high * 1.85, 14000), white)
        travel = 1 - np.exp(-self.t / max(decay * .67, .012))
        if not lift:
            travel = 1 - travel
        flutter = 1 + .11 * self.sweep(25, 8, decay) + .08 * self.sweep(76, 33, decay)
        self.add((rough * (1 - travel) + bright * travel) * self.envelope(attack, decay) * flutter, level, at)

    def body(self, start, end, decay, level, at=0):
        wave = self.sweep(start, end, decay * 1.15, .28)
        texture = self.band(max(35, end * .62), start * 2.2)
        self.add((wave + .23 * texture) * self.envelope(.007, decay), level, at)

    def ring(self, base, decay, level, at=0, modes=(1, 1.49, 2.38, 3.73)):
        tone = np.zeros_like(self.t)
        for index, ratio in enumerate(modes):
            mode = self.sweep(base * ratio * 1.035, base * ratio, .08, .07)
            tone += mode * np.exp(-self.t / (decay / (1 + index * .47))) / (1 + .58 * index)
        self.add(tone * np.minimum(self.t / .004, 1), level, at)

    def debris(self, count, span, low, high, level, at=0):
        for i in range(count):
            when = at + span * (i + self.rng.uniform(0, .8)) / count
            length = round(RATE * self.rng.uniform(.013, .042))
            grain = self.rng.standard_normal(length)
            center = self.rng.uniform(low, high)
            grain = sosfilt(butter(2, (center * .65, center * 1.35), btype='bandpass', fs=RATE, output='sos'), grain)
            env = np.sin(np.linspace(0, np.pi, length)) ** 2
            self.add(grain * env, level * self.rng.uniform(.45, 1), when)

    def finish(self, room, peak):
        dry = self.samples.copy()
        impulse = self.rng.standard_normal(round(.28 * RATE))
        t = np.arange(len(impulse)) / RATE
        impulse = sosfilt(butter(2, (170, 4900), btype='bandpass', fs=RATE, output='sos'), impulse)
        impulse *= np.exp(-t / .047) * np.minimum(t / .03, 1)
        impulse /= max(np.linalg.norm(impulse), 1e-8)
        self.samples += fftconvolve(dry, impulse)[:len(dry)] * room * .24
        for delay, level in ((.018, .23), (.036, -.17), (.067, .12), (.103, -.06)):
            self.add(dry, level * room, delay)
        mix = sosfilt(butter(2, 29, btype='highpass', fs=RATE, output='sos'), self.samples)
        hardness = max(float(np.quantile(np.abs(mix), .97)), .1)
        mix = np.tanh(mix / (2.4 * hardness))
        fade = min(round(.032 * RATE), len(mix) // 4)
        mix[:80] *= np.linspace(0, 1, 80)
        mix[-fade:] *= np.linspace(1, 0, fade) ** 2
        rms = np.sqrt(np.mean(mix ** 2))
        mix *= min(peak / max(np.max(np.abs(mix)), 1e-8), .19 / max(rms, 1e-8))
        return np.rint(mix * 32767).astype('<i2')


def cut(s, weight=1, metal=.36, slow=False):
    s.air(260 / weight, 3150 / weight, .083 * weight, .91, attack=.027 if slow else .012)
    s.air(1300, 7000, .044 * weight, .35, .015)
    s.body(175 / weight, 63, .068 * weight, .54, .008)
    if metal:
        s.ring(820 / weight, .13, metal, .025, (1, 1.77, 2.53, 4.16))
    if slow:
        s.air(310, 1400, .093, .29, .10, .044)


def strike(s, weight=1, metal=0, grit=.4):
    s.body(185 / weight, 46, .076 * weight, 1.19)
    s.air(130, 1050, .074 * weight, .75, attack=.005)
    s.air(1450, 6900, .023, .6, .009, .003)
    s.debris(11, .22 * weight, 470, 3850, grit, .02)
    if metal:
        s.ring(605 / weight, .21, metal, .006, (1, 1.68, 2.81, 4.12, 6.08))


def earth(s, weight=1, stretchy=False):
    s.body(117, 36, .155 * weight, 1.24)
    s.air(95, 695, .106 * weight, .87, attack=.009)
    s.air(480, 3300, .085, .54, .014)
    s.debris(24, .37 * weight, 480, 4900, .65, .024)
    if stretchy:
        s.body(240, 86, .11, .75, .024)
        s.body(184, 67, .082, .42, .117)


def fire(s, weight=1, jet=False):
    s.air(190 / weight, 1620, .19 * weight, .92, attack=.018 if jet else .009)
    s.air(950, 5200, .165 * weight, .48, .018)
    s.body(137, 44, .102 * weight, .75)
    s.debris(29, .34 * weight, 670, 5200, .6, .020)
    if jet:
        s.air(240, 2240, .33 * weight, .61, .12, .12)
        s.air(470, 3400, .11, .29, .39, .11)


def energy(s, level=1, rising=False, cold=False):
    base = (230 if cold else 176) / level ** .27
    s.body(base * 1.22, 54, .16 * level, .72)
    s.air(330, 2370, .13 * level, .52, attack=.025, lift=rising)
    for i, multiplier in enumerate((1, 1.57, 2.07, 3.65, 5.43)):
        start = base * multiplier
        end = start * (2.2 if rising else .60)
        partial = s.sweep(start, end, .22 * level, .16) * s.envelope(.021 + i * .011, .13 * level)
        s.add(partial, .58 / (1 + i * .59), i * .018)
    s.ring(920 if cold else 634, .17 * level, .35, .076)
    s.debris(15, .21 * level, 990, 6100, .33, .04)


def charge(s, cold=False):
    s.air(190, 1750, .24, .54, attack=.105, lift=True)
    for index, offset in enumerate((.00, .074, .153, .242)):
        base = (195 if cold else 124) * (1 + index * .25)
        s.add(s.sweep(base, base * 1.9, .16, .13) * s.envelope(.063, .105), .52 / (1 + .12 * index), offset)
    s.ring(910 if cold else 658,.10,.30,.27)


def wind(s, long=False):
    s.air(147, 1200, .22 if long else .097, .88, attack=.041, lift=True)
    s.air(680, 3800, .22 if long else .075, .63, .04, .026)
    s.body(124, 59, .115, .74)
    if long:
        s.air(330, 2510, .19, .78, .16, .065)
        s.body(88, 39, .22, .46, .26)


def foot(s):
    s.body(137, 53, .045, .84)
    s.air(175, 1490, .027, .35, attack=.006)
    s.debris(8, .11, 750, 3300, .51, .014)


def dodge(s):
    s.air(228, 2180, .081, .83, attack=.026)
    s.air(410, 3600, .055, .5, .075, .022)
    s.body(192, 73, .048, .53, .095)
    s.debris(8,.16,700,3350,.39,.10)


def turn_guard(s):
    s.air(590, 3550, .035, .72, attack=.012)
    s.ring(685,.091,.81,.022)
    s.body(163,81,.047,.47,.033)


def spray(s, feather=False):
    for at in (.00, .029, .067):
        s.air(550 if feather else 470, 4350, .048, .58, at, .007)
        s.ring(715 if feather else 1150,.046,.37,at)
    s.body(172,72,.070,.51)
    s.debris(12,.14,1700,6500,.33,.019)


def shield(s, breaking=False):
    energy(s, 1.62, not breaking, True)
    if breaking:
        s.ring(1650,.16,.50,.04)
        s.debris(30,.33,1550,7530,.71,.011)
    else:
        s.ring(375,.27,.63,.04,(1,1.34,2.07,3.19))


def crystal(s, breaking=False):
    s.ring(1150 if breaking else 515,.19,.8,.005)
    s.air(1700,7500,.048,.64,attack=.006)
    s.body(124,51,.091,.54,.025)
    s.debris(20,.23,920,7400,.67 if breaking else .35,.01)


def rush(s):
    wind(s, True)
    for i, at in enumerate((.042,.152,.249)):
        s.body(130 - i * 17,48,.05,.55,at)
        s.debris(5,.069,420,2800,.33,at)


def royal(s, waves=1):
    earth(s, 1.12)
    for i in range(waves):
        at = .02 + i * .17
        s.body(92 - i * 8,39,.136,.64,at)
        s.air(250, 2100, .12, .53, at, .026)
    s.ring(174,.25,.46,.034,(1,1.38,2.13,2.85))


def quest_signal(s, outcome):
    # Forged-metal overtones and a low drum bind the three signals together.
    if outcome == 'start':
        notes = ((.01, 294, .11), (.13, 440, .13), (.25, 587, .21))
        s.body(144, 53, .10, .55)
        s.air(420, 2700, .074, .44, .01)
    elif outcome == 'clear':
        notes = ((.02, 294, .16), (.18, 440, .20), (.35, 494, .19),
                 (.55, 587, .37), (.55, 370, .26), (.55, 220, .31))
        s.body(122, 46, .16, .65)
        s.body(141, 53, .18, .60, .54)
        s.air(530, 3200, .17, .48, .56, .018)
    else:
        notes = ((.04, 262, .18), (.22, 208, .24), (.44, 131, .35))
        s.body(101, 38, .23, .95)
        s.air(220, 1630, .12, .58, .015)
        s.ring(173, .27, .26, .41, (1, 1.42, 2.04))

    for when, pitch, decay in notes:
        s.ring(pitch, decay, .49, when, (1, 2.01, 2.61, 4.18))
        tone = s.sweep(pitch * .986, pitch, .073, .19)
        s.add(tone * s.envelope(.017, decay * 1.17), .40, when)
        s.air(1850, 5900, .027, .16, when, .005)


# Duration, reflection level, individual peak cap, and render recipe.
RECIPES = {
    'sword-light': (.32,.19,.64,lambda s: cut(s)),
    'sword-heavy': (.48,.24,.70,lambda s: cut(s,1.50,.55,True)),
    'sword-charge': (.56,.20,.50,lambda s: charge(s)),
    'footstep': (.20,.13,.51,foot),
    'dodge': (.34,.20,.59,dodge),
    'guard-raise': (.24,.17,.48,turn_guard),
    'guard-hit': (.51,.31,.70,lambda s: strike(s,.92,1.37,.55)),
    'hit-flesh': (.37,.13,.64,lambda s: strike(s)),
    'hit-armor': (.46,.23,.66,lambda s: strike(s,.95,.95,.65)),
    'hit-player': (.45,.24,.70,lambda s: strike(s,1.42,.27,.58)),
    'magic-charge': (.54,.23,.49,lambda s: charge(s,True)),
    'magic-shot': (.43,.23,.61,lambda s: energy(s,.75,True)),
    'magic-hit': (.44,.25,.63,lambda s: energy(s,.86,False,True)),
    'flare-1': (.74,.38,.68,lambda s: (fire(s,.81),energy(s,1.02))),
    'flare-2': (1.06,.47,.72,lambda s: (fire(s,1.31),energy(s,1.65),s.body(102,37,.22,.72,.17))),
    'flare-3': (1.55,.57,.74,lambda s: (fire(s,2.20,True),royal(s,3),energy(s,2.04))),
    'beast-swipe': (.44,.25,.65,lambda s: cut(s,1.50,0,True)),
    'beast-rush': (.70,.27,.68,rush),
    'beast-spin': (.70,.30,.67,lambda s: wind(s,True)),
    'earth-slam': (.83,.36,.72,earth),
    'shockwave': (.70,.45,.69,lambda s: royal(s,1)),
    'emperor-impact': (1.05,.45,.74,lambda s: royal(s,3)),
    'elastic-slam': (.63,.28,.66,lambda s: earth(s,.73,True)),
    'air-pressure': (.70,.30,.66,lambda s: (wind(s,True),s.body(95,38,.22,.86))),
    'thorn-volley': (.37,.23,.63,spray),
    'thorn-explode': (.68,.32,.69,lambda s: (strike(s,1.32,.22,.83),fire(s,.67))),
    'breath-fire': (1.35,.35,.69,lambda s: fire(s,1.6,True)),
    'flame-shot': (.53,.27,.65,lambda s: fire(s,.83)),
    'fire-wave': (1.50,.47,.73,lambda s: (fire(s,2.08,True),royal(s,2))),
    'wing-dive': (.63,.30,.67,lambda s: (wind(s,True),cut(s,1.39,.14,True))),
    'vortex': (1.05,.42,.65,lambda s: (wind(s,True),s.air(200,1800,.37,.60,.24,.115))),
    'beam-charge': (.68,.29,.53,lambda s: charge(s,True)),
    'beam-release': (1.22,.39,.69,lambda s: (energy(s,2.18,False,True),s.air(540,4600,.36,.68,.04,.038))),
    'shield-on': (.94,.48,.62,shield),
    'shield-break': (.89,.43,.73,lambda s: shield(s,True)),
    'summon': (.99,.46,.67,lambda s: (energy(s,1.68,True,True),s.ring(270,.25,.6,.16))),
    'metal-swipe': (.50,.29,.66,lambda s: cut(s,1.22,.85,True)),
    'feather-volley': (.42,.27,.63,lambda s: spray(s,True)),
    'crystal': (.68,.38,.64,crystal),
    'crystal-burst': (.87,.42,.71,lambda s: crystal(s,True)),
    'quest-start': (.86,.24,.63,lambda s: quest_signal(s,'start')),
    'quest-clear': (1.65,.37,.70,lambda s: quest_signal(s,'clear')),
    'quest-failed': (1.32,.34,.65,lambda s: quest_signal(s,'failed')),
    'wanda-flap': (.84,.34,.60,lambda s: (s.air(85,1600,.27,.8,0,.06), s.body(88,36,.26,.67,.07),s.air(520,5300,.22,.36,.22))),
    'wanda-blade': (.32,.26,.60,lambda s: (cut(s,.96,.34),s.air(650,6900,.11,.62,.05))),
    'wanda-slash': (.77,.41,.73,lambda s: (cut(s,1.78,.79,True),s.body(75,28,.31,.8,.15),s.air(450,3700,.30,.43,.24))),
    'wanda-fall': (.92,.37,.64,lambda s: (s.body(360,43,.40,.68,.15),s.air(680,6100,.27,.57,.18,.11),s.ring(378,.18,.32,.03))),
    'wanda-burst': (.76,.37,.68,lambda s: (earth(s,1.14),s.air(180,4100,.20,.38,.1),s.ring(234,.21,.23,.09))),
    'wanda-gravity': (2.25,.46,.71,lambda s: (s.body(46,102,.82,.75),s.air(88,1130,.64,.58,.24,.21,True),s.ring(74,.88,.35,.66,(1,1.5,2.02,3.04)))),
    'wanda-wave': (.64,.45,.70,lambda s: (royal(s,1),s.body(74,26,.21,.9),s.air(290,2800,.17,.54,.05))),
    'wanda-beam': (1.92,.39,.70,lambda s: (energy(s,1.56,False,True),s.air(460,5800,.59,.51,.1,.10),s.body(143,57,.64,.42,.28))),
    'wanda-dive': (.74,.37,.71,lambda s: (s.air(130,4600,.24,.75,.03,.09,True),s.body(140,35,.28,.73,.18),cut(s,1.78,.38,True))),
    'wanda-vortex': (1.37,.43,.66,lambda s: (wind(s,True),s.air(58,870,.51,.55,.23,.12,True),s.debris(9,.65,830,4500,.25,.32))),
    'wanda-charge': (2.10,.54,.69,lambda s: (charge(s,True),s.ring(147,.84,.57,.60),s.air(80,830,.64,.55,.55,.18,True))),
    'wanda-ultimate': (1.91,.55,.77,lambda s: (royal(s,3),earth(s,1.54),s.ring(86,.52,.50,.29),s.air(150,4300,.62,.49,.23))),
    'wanda-rage': (1.23,.48,.74,lambda s: (s.body(92,48,.57,.66),energy(s,1.2,True,True),s.ring(183,.37,.47,.35),s.air(190,3500,.31,.52,.32))),
    'wanda-hit': (.39,.25,.63,lambda s: (strike(s,.93,.68,.55),s.ring(189,.14,.36,.027))),
    'wanda-death': (1.29,.43,.72,lambda s: (earth(s,1.45),s.ring(94,.51,.40,.23),s.debris(12,.63,230,4600,.46,.22))),
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', nargs='?', type=Path, default=Path(__file__).resolve().parents[1] / 'public/audio/sfx')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    for index, (name, (duration, room, peak, recipe)) in enumerate(RECIPES.items()):
        sound = Sound(duration, 34589 + index * 197)
        recipe(sound)
        with wave.open(str(args.output / f'{name}.wav'), 'wb') as wav:
            wav.setparams((1, 2, RATE, 0, 'NONE', 'not compressed'))
            wav.writeframes(sound.finish(room, peak).tobytes())


if __name__ == '__main__':
    main()
