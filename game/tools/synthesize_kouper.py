"""Generate the original mono sound cues for Kouper Toiper."""
from pathlib import Path
import wave

import numpy as np


RATE = 32000
SFX = Path(__file__).resolve().parents[1] / 'public' / 'audio' / 'sfx'
PROFILES = {
    'head': (.24, 125, 52, .52, 1),
    'double': (.20, 264, 91, .55, 2),
    'slide': (.43, 175, 47, .83, 1),
    'sweep': (.27, 449, 140, .63, 1),
    'leap': (.38, 104, 39, .49, 1),
    'spin': (.43, 365, 53, .69, 3),
    'chain': (.41, 196, 96, .31, 3),
    'stamp': (.14, 455, 205, .73, 1),
    'warning': (.26, 960, 1510, .08, 3),
    'pop': (.36, 173, 40, .60, 1),
    'stick': (.22, 308, 688, .48, 1),
    'clear': (.28, 707, 1380, .35, 2),
    'ultimate': (.85, 69, 268, .39, 3),
    'final': (.94, 101, 30, .60, 1),
    'rage': (.68, 290, 58, .53, 2),
}


def generate(name, index, profile):
    duration, start, end, grit, pulses = profile
    rng = np.random.default_rng(2840 + index)
    t = np.arange(int(RATE*duration))/RATE
    w = t/duration
    frequency=end+(start-end)*np.exp(-5*w)
    phase=2*np.pi*np.cumsum(frequency)/RATE
    attack=np.minimum(1,t/(.022 if name in ('slide','ultimate','rage') else .008))
    envelope=attack*(1-w)**1.9*np.exp(-w*(1.4 if pulses==1 else .6))
    noise=rng.normal(0,1,len(t))
    filtered=np.convolve(noise,np.array([.12,.25,.30,.22,.11]),mode='same')
    rhythm=.38+.62*np.sin(np.pi*(w*pulses+.19))**4 if pulses>1 else 1
    wavelet=(.75*np.sin(phase)+.21*np.sin(phase*1.43)+.07*np.sin(phase*2.07))
    body=(1-grit)*wavelet+grit*(filtered*.85+.15*noise)
    if name in ('pop','final','leap'):
        body+=np.sin(2*np.pi*(43*t+4*(1-np.exp(-15*t))))*.38*np.exp(-6*w)
    audio=np.int16(np.clip(np.tanh(body*envelope*rhythm*1.4)*.86,-1,1)*32767)
    with wave.open(str(SFX/f'paper-{name}.wav'),'wb') as out:
        out.setparams((1,2,RATE,0,'NONE','not compressed'))
        out.writeframes(audio.tobytes())


if __name__ == '__main__':
    for i, (name,profile) in enumerate(PROFILES.items()):
        generate(name,i,profile)
