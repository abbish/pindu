"""Per-video layout, extracted from the adopted v7 renderer; inputs live in render.json."""
from PIL import Image, ImageDraw, ImageOps
import render_support as b

def prepare(config, repo):
    global CFG, T, C, W, H, STARTS, ENDS, HOME, HOME_FULL, PRACTICE, TUTOR
    global WORDS, PASSAGE, PLAN, SMALL_PRACTICE, CLIPS, EDITOR, MOVIE
    global COPIES, SCENARIO, TARGETS, MODE_LABELS, txt, rounded, place, ease, smooth
    if config['size'] != [1920, 1080] or len(config['scenes']) != 8:
        raise ValueError('This layout supports 1920×1080 and its eight scenes; adapt layout for another composition')
    CFG, T = config, config['text']
    b.configure(config, repo)
    C, W, H = b.C, b.W, b.H
    txt, rounded, place, ease, smooth = b.txt, b.rounded, b.place, b.ease, b.smooth
    STARTS=[s['start'] for s in config['scenes']]
    ENDS=[s['end'] for s in config['scenes']]
    def card(name):
        a=config['assets'][name]
        return b.screen(a['path'], a['crop'], a['width'], a['label'])
    HOME=Image.open(repo/config['assets']['home']['path']).convert('RGBA')
    HOME_FULL=HOME.resize((1260,846),Image.Resampling.LANCZOS)
    WORDS, PASSAGE, PLAN = card('words'), card('passage'), card('plan')
    PRACTICE, TUTOR, CLIPS, EDITOR = card('practice'), card('tutor'), card('clips'), card('editor')
    SMALL_PRACTICE=PRACTICE.resize((790,606),Image.Resampling.LANCZOS)
    a=config['assets']['movie']
    MOVIE=ImageOps.fit(Image.open(repo/a['path']).convert('RGB').crop(a['crop']), tuple(a['size']), method=Image.Resampling.LANCZOS)
    COPIES={int(k):copy(v['label'],v['lines'],v['body']) for k,v in config['copies'].items()}
    SCENARIO=context_card(T['scenario_title'],T['scenario_items'])
    TARGETS=context_card(T['targets_title'],T['targets_items'])
    MODE_LABELS=config['video_modes']

def picture(im, source, box, radius=17):
    x,y,w,h=box
    source=ImageOps.fit(source,(w,h),method=Image.Resampling.LANCZOS).convert('RGBA')
    mask=Image.new('L',(w,h));rounded(mask,(0,0,w-1,h-1),255,radius)
    source.putalpha(mask);place(im,source,x,y)

def film_credit(im,y=956,dark=False,anchor='lt',x=834):
    txt(im,(x,y),T['film_credit'],16,'#90B2A0' if dark else '#71897C',anchor=anchor)

def video_learning(t):
    mode=min(2,int(t/3))
    local=t-mode*3
    stage=Image.new('RGBA',(1054,794))
    rounded(stage,(4,4,1049,789),'white',29,outline='#DCE7DC')
    txt(stage,(39,31),T['video_title'],25,C['ink'],True)
    rounded(stage,(848,24,1019,62),'#E4EDE2',19)
    txt(stage,(871,33),T['illustration_label'],19,C['gray'])
    picture(stage,MOVIE,(35,90,980,409),20)
    if mode<2:
        rounded(stage,(252,397,797,477),(3,24,22,200),16)
        txt(stage,(526,410),T['video_sentence'],36,'white',latin=True,anchor='mt')
        txt(stage,(526,454),T['video_translation'],21,'#E0EAE0',anchor='mt')
    for j,label in enumerate(CFG['video_tabs']):
        x=39+j*173
        rounded(stage,(x,518,x+154,566),C['teal'] if j==mode else '#F2F5F0',24)
        txt(stage,(x+77,531),label,22,'white' if j==mode else C['gray'],True,anchor='mt')
    if mode==0:
        txt(stage,(43,604),T['video_sentence'],43,C['ink'],True,latin=True)
        txt(stage,(43,669),T['video_translation'],25,C['gray'])
        b.wave_bars(stage,738,652,t,C['teal'],17,28)
        txt(stage,(43,727),T['video_click_hint'],22,C['teal'])
    elif mode==1:
        txt(stage,(43,598),T['video_record_hint'],29,C['ink'],True)
        for j,label in enumerate(CFG['record_labels']):
            x=43+j*493
            rounded(stage,(x,656,x+468,758),'#EAF4EB' if j==0 else '#FCF7D8',22)
            txt(stage,(x+23,693),label,22,C['teal'],True)
            b.wave_bars(stage,x+169,708,t*1.1+j*2,C['teal'] if j==0 else '#AA943C',19,33)
    else:
        txt(stage,(43,596),T['video_listen_hint'],27,C['ink'],True)
        answer=CFG['video_answer']
        picked=min(4,int(max(0,local-.1)/.35))
        x=43
        for j,word in enumerate(answer):
            ww=155 if word!='?' else 83
            if j<picked:
                rounded(stage,(x,649,x+ww,706),'#DEF0E3',14)
                txt(stage,(x+ww/2,662),word,29,C['teal'],True,latin=True,anchor='mt')
            else:
                rounded(stage,(x,649,x+ww,706),'#F8FAF6',14,outline='#DDE6DB')
            x+=ww+15
        txt(stage,(45,738),T['video_check_hint'],22,C['gray'])
        if picked==4:
            rounded(stage,(727,649,984,706),C['teal'],28)
            txt(stage,(855,663),T['video_success'],23,'white',True,anchor='mt')
    return stage,mode

def practice_cards(t):
    layer=Image.new('RGBA',(1037,238))
    cards=CFG['practice_cards']
    for j,(name,action,desc) in enumerate(cards):
        p=ease((t-.55-j*.12)/.55)
        card=Image.new('RGBA',(319,195))
        rounded(card,(2,2,316,192),'#FCFDF8',23,outline='#D9E4D7')
        txt(card,(24,23),name,26,C['teal'],True)
        txt(card,(24,71),action,31,C['ink'],True)
        txt(card,(24,138),desc,18,C['gray'])
        place(layer,card,j*344,26*(1-p),p)
    return layer

def header(im,dark=False):
    color='#F5F8F0' if dark else C['ink']
    rounded(im,(88,55,138,105),C['teal'],14)
    txt(im,(113,79),T['brand_glyph'],30,'white',True,anchor='mm')
    txt(im,(157,64),T['brand_name'],31,color,True)
    txt(im,(241,69),T['brand_latin'],23,'#B4D4C8' if dark else C['gray'],latin=True)
    txt(im,(1832,76),T['header_tagline'],20,'#B4D4C8' if dark else C['gray'],anchor='rt')

def footer(im,n,dark=False):
    muted='#8BAEA0' if dark else '#82958C'
    labels=CFG['footer_labels']
    for j,label in enumerate(labels):
        x=90+j*148
        ImageDraw.Draw(im).line((x,997,x+112,997),fill=C['yellow'] if j==n else ('#38574D' if dark else '#D9E3DA'),width=4)
        txt(im,(x,1013),label,17,C['yellow'] if dark and j==n else (C['teal'] if j==n else muted))
    txt(im,(1832,1013),T['footer_brand'],17,muted,latin=True,anchor='rt')

def copy(label,lines,body):
    layer=Image.new('RGBA',(W,H))
    width=int(ImageDraw.Draw(layer).textlength(label,font=b.font(22,True)))+58
    rounded(layer,(110,220,110+width,266),'#DEEEE2',23)
    txt(layer,(139,233),label,22,C['teal'],True)
    for j,line in enumerate(lines):txt(layer,(108,331+j*107),line,78,C['ink'],True)
    for j,line in enumerate(body):txt(layer,(112,584+j*45),line,28,C['gray'])
    return layer

def context_card(title,items):
    layer=Image.new('RGBA',(635,172))
    rounded(layer,(0,0,634,171),'#E3EEDF',25)
    txt(layer,(27,25),title,23,C['gray'])
    txt(layer,(27,83),items,31,C['teal'],True)
    return layer

def ui_outline(im,source_box,crop_box,x,y,width=1000):
    """Map an actual screenshot rectangle through the same crop/scale as its card."""
    cx,cy,cw,ch=crop_box
    scale=width/(cw-cx)
    x1,y1,x2,y2=source_box
    box=(x+32+(x1-cx)*scale,y+72+(y1-cy)*scale,
         x+32+(x2-cx)*scale,y+72+(y2-cy)*scale)
    ImageDraw.Draw(im).rounded_rectangle(tuple((a-5 if j<2 else a+5) for j,a in enumerate(box)),12,outline=C['teal'],width=3)

def crossfade_assets(im,first,second,x,y,progress,alpha=1):
    """Crossfade on a fixed canvas without resizing either source screenshot."""
    canvas_size=(max(first.width,second.width),max(first.height,second.height))
    a=Image.new('RGBA',canvas_size);a.alpha_composite(first)
    z=Image.new('RGBA',canvas_size);z.alpha_composite(second)
    place(im,Image.blend(a,z,smooth(progress)),x,y,alpha)

def home_opening(t):
    im=b.DARK.copy();header(im,True)
    txt(im,(105,273),T['brand_name'],99,'#F5F8F0',True)
    txt(im,(111,407),T['brand_latin'],36,'#B7D9C7',latin=True)
    if t<CFG['motion']['intro_focus_start']:
        txt(im,(112,538),T['intro_line1'],34,'#D7E9DC')
        txt(im,(112,590),T['intro_line2'],34,'#D7E9DC')
        rounded(im,(111,695,495,750),C['yellow'],27)
        txt(im,(138,710),T['intro_badge'],23,C['ink'],True)
    else:
        for j,name in enumerate(CFG['intro_materials']):
            y=524+j*93
            p=ease((t-CFG['motion']['intro_focus_start']-j*.14)/.42)
            layer=Image.new('RGBA',(379,72))
            rounded(layer,(0,0,378,71),'#224C40',22)
            txt(layer,(29,18),name,32,'#F5F8F0',True)
            txt(layer,(337,21),'→',28,C['yellow'],anchor='mt')
            place(im,layer,112-25*(1-p),y,p)
    p=1
    if t<=CFG['motion']['intro_focus_start']:
        screenshot=HOME_FULL
    else:
        z=ease((t-CFG['motion']['intro_focus_start'])/CFG['motion']['intro_focus_duration'])
        full=CFG['assets']['home']['full_crop'];focus=CFG['assets']['home']['focus_crop']
        box=tuple(round(a+(d-a)*z) for a,d in zip(full,focus))
        screenshot=HOME.crop(box).resize((1260,846),Image.Resampling.LANCZOS)
    layer=Image.new('RGBA',(1284,870))
    rounded(layer,(8,8,1276,862),'#DDE8DE',20)
    mask=Image.new('L',screenshot.size);rounded(mask,(0,0,1259,845),255,16)
    screenshot=screenshot.copy();screenshot.putalpha(mask)
    layer.alpha_composite(screenshot,(12,12))
    place(im,layer,571+48*(1-p),122+18*(1-p),p)
    footer(im,0,True)
    return im.convert('RGB')

def opening(t):
    return home_opening(t)

def outro(t):
    im=b.DARK.copy();header(im,True)
    layer=Image.new('RGBA',(W,H));p=1
    rounded(layer,(798,192,890,284),C['teal'],25)
    txt(layer,(844,237),T['brand_glyph'],58,'white',True,anchor='mm')
    txt(layer,(932,190),T['brand_name'],95,'#F5F8F0',True)
    txt(layer,(960,369),T['outro_line1'],61,'#F5F8F0',True,anchor='mt')
    txt(layer,(960,454),T['outro_line2'],61,'#F5F8F0',True,anchor='mt')
    txt(layer,(960,554),T['outro_body'],28,'#B7D9C7',anchor='mt')
    rounded(layer,(677,652,1243,728),C['yellow'],38)
    txt(layer,(960,675),T['outro_cta'],31,C['ink'],True,anchor='mt')
    txt(layer,(960,779),T['outro_url'],34,'#B7D9C7',latin=True,anchor='mt')
    txt(layer,(960,832),T['outro_platforms'],23,'#91B6A3',latin=True,anchor='mt')
    txt(layer,(960,888),T['outro_ai_note'],16,'#8CAB9C',anchor='mt')
    film_credit(layer,925,True,'mt',960)
    txt(layer,(960,950),T['film_source'],15,'#90B2A0',anchor='mt')
    place(im,layer,0,28*(1-p),p);footer(im,7,True)
    return im.convert('RGB')

def scene(n,t):
    if n==0:return opening(t)
    if n==7:return outro(t)
    im=b.LIGHT.copy();header(im)
    p=ease(t/.65);q=ease((t-.13)/.75);dy=0
    if n in COPIES:place(im,COPIES[n],-25*(1-p),0,p)
    if n==1:
        place(im,SCENARIO,112,698+22*(1-q),q)
        if t<CFG['motion']['words_crossfade'][0]:place(im,WORDS,797+65*(1-q),105,q)
        elif t<CFG['motion']['words_crossfade'][1]:crossfade_assets(im,WORDS,PRACTICE,797,105,(t-CFG['motion']['words_crossfade'][0])/(CFG['motion']['words_crossfade'][1]-CFG['motion']['words_crossfade'][0]))
        else:place(im,PRACTICE,797,105)
    elif n==2:
        place(im,TARGETS,112,698+22*(1-q),q)
        place(im,PASSAGE,797+65*(1-q),135+dy,q)
        # Highlight the real screenshot's "生成题组" action, without changing UI text.
        if t>CFG['motion']['quiz_highlight']:ui_outline(im,CFG['highlights']['passage_quiz'],CFG['assets']['passage']['crop'],797,135)
    elif n==3:
        steps=CFG['video_steps'];active=min(2,int(t/2))
        for j,label in enumerate(steps):
            x=112+j*201
            rounded(im,(x,735,x+172,794),C['teal'] if j<=active else '#DFE8DE',29)
            txt(im,(x+86,753),label,24,'white' if j<=active else C['gray'],True,anchor='mt')
            if j<2:txt(im,(x+186,765),'→',20,C['gray'],anchor='mm')
        if t<CFG['motion']['video_crossfade'][0]:place(im,CLIPS,797+65*(1-q),181,q)
        elif t<CFG['motion']['video_crossfade'][1]:crossfade_assets(im,CLIPS,EDITOR,797,181,(t-CFG['motion']['video_crossfade'][0])/(CFG['motion']['video_crossfade'][1]-CFG['motion']['video_crossfade'][0]))
        else:
            place(im,EDITOR,797,181)
            if CFG['motion']['ai_plan_highlight'][0]<t<CFG['motion']['ai_plan_highlight'][1]:ui_outline(im,CFG['highlights']['video_ai_plan'],CFG['assets']['editor']['crop'],797,181)
            if t>=CFG['motion']['ai_plan_highlight'][1]:ui_outline(im,CFG['highlights']['video_split'],CFG['assets']['editor']['crop'],797,181)
        film_credit(im,965)
    elif n==4:
        rounded(im,(110,218,278,264),'#DEEEE2',23)
        txt(im,(149,232),T['video_title'],22,C['teal'],True)
        txt(im,(108,328),T['video_headline'],81,C['ink'],True)
        txt(im,(112,453),T['video_body'],28,C['gray'])
        stage,mode=video_learning(t*9/(ENDS[4]-STARTS[4]))
        place(im,stage,799+65*(1-q),149+dy,q)
        descriptions=CFG['video_descriptions']
        for j,label in enumerate(MODE_LABELS):
            y=568+j*121
            rounded(im,(111,y,714,y+99),C['teal'] if j==mode else '#E7EFE5',22)
            txt(im,(138,y+17),label,29,'white' if j==mode else C['ink'],True)
            txt(im,(139,y+61),descriptions[j],21,'#CDEADA' if j==mode else C['gray'])
        film_credit(im,964)
    elif n==5:
        place(im,TUTOR,1167+65*(1-q),123+dy,q)
        r=ease((t-.5)/.7)
        place(im,b.floating_word_card(t),814+35*(1-r),381-dy,r)
        txt(im,(114,730),T['tutor_note'],24,C['teal'],True)
    elif n==6:
        rounded(im,(111,753,715,823),'#E1ECDD',26)
        txt(im,(138,777),T['plan_steps'],25,C['teal'],True)
        if t<CFG['motion']['practice_crossfade'][0]:
            place(im,SMALL_PRACTICE,939+50*(1-q),142+dy,q)
            place(im,practice_cards(t),823,766)
        else:
            r=ease((t-CFG['motion']['practice_crossfade'][0])/(CFG['motion']['practice_crossfade'][1]-CFG['motion']['practice_crossfade'][0]))
            place(im,SMALL_PRACTICE,939,142+dy,1-r)
            place(im,practice_cards(t),823,766,1-r)
            place(im,PLAN,797+45*(1-r),143+dy,r)
    footer(im,n)
    return im.convert('RGB')

def frame(t):
    n=max(j for j,s in enumerate(STARTS) if t>=s);local=t-STARTS[n]
    im=scene(n,local)
    if n>0 and n<7 and local<CFG['motion']['scene_transition']:
        im=Image.blend(scene(n-1,ENDS[n-1]-STARTS[n-1]+local),im,smooth(local/CFG['motion']['scene_transition']))
    # Finish the outro transition before 40s so the URL stays fully visible for 5s.
    outro_start=STARTS[-1]
    transition=CFG['motion']['outro_transition']
    if outro_start-transition<t<outro_start:
        im=Image.blend(im,outro(0),smooth((t-(outro_start-transition))/transition))
    return im
