"""Reusable screenshot composition and original instrumental synthesis."""
from pathlib import Path
import math
import os
import wave
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

FONTS = {}

def configure(config, repo):
    global REPO, W, H, DURATION, STARTS, C, TEXT, LIGHT, DARK, FONT_SPECS
    REPO = repo
    W, H = config['size']
    DURATION = config['duration']
    STARTS = [scene['start'] for scene in config['scenes']]
    C = config['palette']
    TEXT = config['text']
    FONT_SPECS = resolve_fonts()
    FONTS.clear()
    LIGHT, DARK = bg(), bg(True)

def resolve_fonts():
    pingfang = next(Path('/System/Library/AssetsV2/com_apple_MobileAsset_Font8').glob('*/AssetData/PingFang.ttc'), None)
    candidates = [pingfang, Path('/System/Library/Fonts/PingFang.ttc'),
                  Path('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'),
                  Path('C:/Windows/Fonts/msyh.ttc')]
    regular = os.environ.get('PROMO_FONT_REGULAR') or next((str(p) for p in candidates if p and p.is_file()), None)
    if not regular or not Path(regular).is_file():
        raise ValueError('Chinese font unavailable: set PROMO_FONT_REGULAR to a CJK font')
    bold = os.environ.get('PROMO_FONT_BOLD', regular)
    avenir = Path('/System/Library/Fonts/Avenir Next.ttc')
    latin = os.environ.get('PROMO_FONT_LATIN', str(avenir) if avenir.is_file() else regular)
    for path in (bold, latin):
        if not Path(path).is_file():
            raise ValueError(f'Font not found: {path}')
    def spec(path, kind):
        is_pingfang = Path(path).name == 'PingFang.ttc'
        index = (11 if kind == 'bold' else 3) if is_pingfang else 0
        return path, int(os.environ.get(f'PROMO_FONT_{kind.upper()}_INDEX', index))
    return {'regular': spec(regular, 'regular'), 'bold': spec(bold, 'bold'),
            'latin': (latin, int(os.environ.get('PROMO_FONT_LATIN_INDEX', 7 if Path(latin).name == 'Avenir Next.ttc' else 0))),
            'latin_bold': (latin, int(os.environ.get('PROMO_FONT_LATIN_BOLD_INDEX', 0)))}

def font(size, bold=False, latin=False):
    key = (size, bold, latin)
    if key not in FONTS:
        kind = ('latin_bold' if bold else 'latin') if latin else ('bold' if bold else 'regular')
        path, index = FONT_SPECS[kind]
        FONTS[key] = ImageFont.truetype(path, size, index=index)
    return FONTS[key]

def txt(im, xy, text, size, color=None, bold=False, latin=False, anchor='lt'):
    ImageDraw.Draw(im).text(xy, text, font=font(size,bold,latin), fill=color or C['ink'], anchor=anchor, stroke_width=0)

def rounded(im, box, fill, radius=24, outline=None, width=1):
    ImageDraw.Draw(im).rounded_rectangle(box, radius, fill=fill, outline=outline, width=width)

def ease(x):
    x = max(0, min(1, x))
    return 1 - (1-x)**3

def smooth(x):
    x = max(0,min(1,x))
    return x*x*(3-2*x)

def place(canvas, layer, x, y, alpha=1):
    if alpha <= 0: return
    if alpha < .999:
        layer = layer.copy()
        layer.putalpha(layer.getchannel('A').point(lambda a: int(a*alpha)))
    canvas.paste(layer, (round(x),round(y)), layer)

def bg(dark=False):
    yy, xx = np.mgrid[0:H,0:W]
    if dark:
        base=np.array([9,38,35],dtype=float)
        g=np.exp(-(((xx-1510)/840)**2+((yy-370)/660)**2))
        a=base[None,None,:]+g[:,:,None]*np.array([7,37,27])
    else:
        base=np.array([245,248,244],dtype=float)
        g=np.exp(-(((xx-1480)/650)**2+((yy-480)/620)**2))
        a=base[None,None,:]+g[:,:,None]*np.array([-14,-4,-8])
    rng=np.random.default_rng(27)
    a+=rng.uniform(-.45,.45,(H,W,1))
    im=Image.fromarray(np.uint8(np.clip(a,0,255)),'RGB').convert('RGBA')
    d=ImageDraw.Draw(im)
    if dark:
        for r in [345,435,525,615]:
            d.ellipse((1460-r,460-r,1460+r,460+r),outline=(59,101,88,90),width=2)
    else:
        d.arc((1230,-310,2200,660),100,310,fill='#DCE9E0',width=2)
    return im

def screen(filename, crop, width, label):
    source=Image.open(REPO/filename).convert('RGB').crop(crop)
    height=round(source.height*width/source.width)
    source=source.resize((width,height),Image.Resampling.LANCZOS).convert('RGBA')
    layer=Image.new('RGBA',(width+64,height+116))
    shadow=Image.new('RGBA',layer.size)
    rounded(shadow,(32,38,width+32,height+98),(5,50,38,35),27)
    shadow=shadow.filter(ImageFilter.GaussianBlur(19))
    layer.alpha_composite(shadow)
    rounded(layer,(24,20,width+40,height+82),'white',24,outline='#DFE9E0')
    for j,c in enumerate(['#E89784','#E7D279','#8BB49D']):
        ImageDraw.Draw(layer).ellipse((44+j*22,40,55+j*22,51),fill=c)
    txt(layer,(123,36),label,20,C['gray'])
    mask=Image.new('L',source.size,0)
    rounded(mask,(0,0,width,height),255,14)
    source.putalpha(mask)
    layer.alpha_composite(source,(32,72))
    return layer

def wave_bars(im,x,y,t,color,count=17,height=35):
    d=ImageDraw.Draw(im)
    for i in range(count):
        h=7+height*(.32+.68*(.5+.5*math.sin(t*5.4+i*.8)))*math.sin(math.pi*(i+1)/(count+1))
        d.rounded_rectangle((x+i*13,y-h/2,x+i*13+5,y+h/2),3,fill=color)

def floating_word_card(t):
    im=Image.new('RGBA',(340,360))
    rounded(im,(8,8,330,339),'#DCEEDF',25,outline='#C7DECC')
    txt(im,(38,38),TEXT['word_card_title'],20,C['gray'])
    txt(im,(38,90),TEXT['word_card_line1'],40,C['ink'],True,latin=True)
    txt(im,(38,143),TEXT['word_card_line2'],40,C['ink'],True,latin=True)
    txt(im,(39,212),TEXT['word_card_translation'],27,C['teal'],True)
    ImageDraw.Draw(im).line((40,270,293,270),fill='#BED8C7',width=2)
    txt(im,(40,290),TEXT['word_card_prompt'],21,C['teal'])
    return im

def music(output):
    sr=48000
    sound=np.zeros((int((DURATION+.2)*sr),2),np.float64)
    rng=np.random.default_rng(21)
    beat=60/110
    def mix(start,signal,pan=0):
        offset=int(start*sr)
        count=min(len(signal),len(sound)-offset)
        if count<=0:return
        sound[offset:offset+count,0]+=signal[:count]*math.sqrt((1-pan)/2)
        sound[offset:offset+count,1]+=signal[:count]*math.sqrt((1+pan)/2)
    def note(midi,start,length,amp,pan=0,pad=False):
        t=np.arange(int(length*sr))/sr
        f=440*2**((midi-69)/12)
        if pad:
            env=np.minimum(1,t/.32)*np.minimum(1,(length-t)/.45)
            s=(np.sin(2*np.pi*f*t)+.24*np.sin(2*np.pi*f*2*t)+.12*np.sin(2*np.pi*f*.998*t))*env*amp
        else:
            env=(1-np.exp(-t*190))*np.exp(-t*4.0)*np.minimum(1,(length-t)/.05)
            s=(np.sin(2*np.pi*f*t)+.28*np.sin(2*np.pi*f*2*t)+.1*np.sin(2*np.pi*f*3*t))*env*amp
        mix(start,s,pan)
        if not pad:
            mix(start+.19,s*.17,-pan)
            mix(start+.38,s*.07,pan)
    # Original instrumental: restrained electric-piano arpeggios and warm pads.
    chords=[[48,55,60,64,71],[43,50,55,59,66],[45,52,57,60,67],[41,48,53,57,64]]
    for k in range(math.ceil(DURATION/(4*beat))):
        start=k*4*beat
        chord=chords[k%4]
        for j,n in enumerate(chord[1:]):note(n,start,4*beat+.2,.012,(-.45+j*.3),True)
        note(chord[0]-12,start,2*beat,.07,0,True)
        for j in range(8):
            melody=chord[1+(j%4)]+12
            note(melody,start+j*beat/2,1.6,.070 if j%2==0 else .052,(-.35 if j%2==0 else .35))
    for k in range(int(DURATION/beat)+1):
        start=k*beat
        t=np.arange(int(.22*sr))/sr
        phase=2*np.pi*(48*t+7*(1-np.exp(-t*30)))
        kick=np.sin(phase)*np.exp(-t*28)*.055
        mix(start,kick)
        h=rng.normal(0,1,int(.06*sr))
        h=np.concatenate(([0],np.diff(h)))
        h*=np.exp(-np.arange(len(h))/sr*90)*.009
        mix(start+beat/2,h,.2)
    # Soft transitions at the same moments as the on-screen changes.
    for start in STARTS[1:]:
        t=np.arange(int(.65*sr))/sr
        noise=rng.normal(0,1,len(t))
        filtered=np.convolve(noise,np.ones(70)/70,'same')
        mix(start-.2,filtered*np.sin(np.pi*t/.65)**2*.048,-.15)
    sound=sound[:int(DURATION*sr)]
    ti=np.arange(len(sound))/sr
    fade=np.minimum(1,ti/.45)*np.minimum(1,np.maximum(0,(DURATION-ti)/1.0))
    sound*=fade[:,None]
    peak=np.max(np.abs(sound))
    sound*=.69/peak
    with wave.open(str(output),'wb') as out:
        out.setnchannels(2);out.setsampwidth(2);out.setframerate(sr)
        out.writeframes(np.int16(np.clip(sound,-1,1)*32767).tobytes())
