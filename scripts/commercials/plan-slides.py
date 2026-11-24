# The 100-slide plan (Horace 11/24: "mix of A and B"). Kind, family-friendly humor; each slide is one person (or pet)
# from their own photos only, so faces stay theirs. A = 1980s TV commercial still, B = realistic photo with a fun set.
# Writes data/commercials/plan.json; run-slides.py makes them (resumable).
import json, os, random

ROOT = '/mnt/c/Users/Owner/Documents/watson'
FP = 'data/family-photos'
def pool(*names): return [f'{FP}/{n}' for n in names]
PEOPLE = {
    'horace': ('Horace, a bearded man with glasses', pool('picks/horace-20260830_121459.jpg', 'picks/horace-FB_IMG_1793041139661.jpg', 'picks/horace-20260901_110203.jpg', 'picks/horace-20261008_081315.jpg', 'picks/horace-20260826_092520.jpg'), [
        ('THE ORACLE WHISPERER', 'HE TALKS. IT LISTENS.', 'talking into a glowing crystal ball computer at night'),
        ('DAD JOKE DELUXE', 'NOW 50% CORNIER', 'holding a microphone on a comedy club stage'),
        ('KING OF THE GRILL', 'SMOKE SIGNALS INCLUDED', 'flipping burgers at a big smoky grill'),
        ('CAPTAIN COFFEE', 'POWERED BY BEANS', 'holding a giant steaming coffee mug like a trophy'),
        ('THE BEARD OF WISDOM', 'ASK IT ANYTHING', 'stroking his beard thoughtfully in a library'),
        ('MR. FIX IT', 'DUCT TAPE CERTIFIED', 'wearing a tool belt with a roll of duct tape'),
        ('WIFI WIZARD', 'ONE BAR? NOT ON HIS WATCH', 'wearing a wizard hat pointing a wand at a router'),
        ('THE LIST MAKER', 'HE HAS A LIST FOR HIS LISTS', 'holding an enormously long paper list that rolls onto the floor'),
        ('CHRISTMAS LIGHTS KING', 'VISIBLE FROM SPACE', 'on a ladder wrapped in Christmas lights in front of a glowing house'),
        ('SMOKE SHACK LEGEND', 'LOW AND SLOW SINCE FOREVER', 'next to a rustic backyard smokehouse'),
        ('ROAD TRIP COMMANDER', 'ARE WE THERE YET? NO.', 'holding a big paper map beside a family van'),
        ('NAP CHAMPION', 'UNDEFEATED ON THE COUCH', 'asleep in a recliner wearing a gold medal'),
        ('SUNDAY BEST', 'CHURCH CLOTHES ACTIVATED', 'in a crisp button-up shirt with a big friendly smile on a sunny morning'),
        ('APP BUILDER 3000', 'THERE IS A BUTTON FOR THAT', 'surrounded by floating glowing phone screens'),
        ('THE WEATHER MAN', 'TEXAS: ALL FOUR SEASONS TODAY', 'as a TV weatherman in front of a Texas weather map'),
        ('GRILLMASTER GENERAL', 'YES, CHEF', 'in a chef hat holding a spatula like a sword'),
        ('THE PLANNER', 'EVERY MINUTE ACCOUNTED FOR', 'pointing at a huge colorful calendar wall'),
        ('COWBOY HORACE', 'YEEHAW, RESPONSIBLY', 'in a cowboy hat at sunset by a wooden fence'),
        ('REMOTE CONTROL', 'HE DECIDES WHAT WE WATCH', 'holding a TV remote like a royal scepter on a throne'),
        ('PAPPY SKILLET COOKS', 'COME AND GET IT', 'in a country kitchen holding a big cast iron skillet'),
    ]),
    'taylor': ('Taylor, a bearded man', pool('picks/taylor-20250513_193420.jpg', 'picks/taylor-20241225_102742.jpg', 'picks/taylor-20260224_191502.jpg', 'picks/taylor-20250904_205009.jpg', 'picks/taylor-20260901_182224.jpg', 'taylor-1-face.jpg'), [
        ('THE 5 AM GRIND', 'HE WAKES BEFORE THE ROOSTER', 'holding a travel coffee mug at dawn by his pickup truck'),
        ('COWBOYS FAN NO. 1', 'HOW BOUT THEM COWBOYS', 'in a stadium crowd cheering in a blue cap'),
        ('RIB EATING CHAMPION', 'NAPKINS NOT INCLUDED', 'at a barbecue table piled high with ribs'),
        ('BONFIRE BOSS', 'HE BRINGS THE FIRE', 'beside a big safe campfire at night under the stars'),
        ('BIRTHDAY KING', 'CROWN REQUIRED', 'wearing a paper birthday crown and sunglasses'),
        ('THUMBS UP GUY', 'APPROVED BY TAYLOR', 'giving a giant thumbs up with fireworks behind him'),
        ('TRUCK WHISPERER', 'SHE RUNS ON LOVE AND DIESEL', 'leaning proudly on a shiny pickup truck'),
        ('DAD OF THE YEAR', 'JAKE AND KAI APPROVED', 'holding a big golden dad trophy'),
        ('COUCH COMMANDER', 'RECLINE AND CONQUER', 'relaxing on a couch with a big blanket'),
        ('THE ROAD WARRIOR', 'TRAFFIC FEARS HIM', 'driving a truck with sunglasses on, wind in his hair'),
        ('SNACK ATTACK', 'BAG OF CHIPS: GONE', 'holding a giant bag of chips with crumbs everywhere'),
        ('MR. RELIABLE', 'ALWAYS SHOWS UP', 'standing heroically in work clothes as the sun rises'),
        ('FISHING LEGEND', 'IT WAS THIS BIG', 'holding a fishing rod on a lake dock at sunrise'),
        ('THE GRILL SERGEANT', 'MEDIUM RARE, SIR', 'saluting next to a barbecue grill'),
        ('CHURCH FAMILY MAN', 'SUNDAY MORNING READY', 'in a nice shirt smiling outside a small country church'),
        ('CAPTAIN COMFORT', 'BLANKET CAPE ENGAGED', 'wearing a blanket like a superhero cape'),
        ('WORKHORSE', 'OVERTIME IS HIS CARDIO', 'carrying a stack of boxes with a big grin'),
        ('BEST FRIEND FOREVER', 'WOLF HALL PARTNER IN CRIME', 'giving a big laugh at a backyard cookout'),
    ]),
    'tatiyana': ('Tatiyana, a teenage girl with curly dark hair', pool('picks/tati-20260906_130935.jpg', 'picks/tati-20260426_162821.jpg', 'picks/tati-20250323_153711.jpg', 'picks/tati-20250316_152334.jpg', 'tatiyana-1.jpg'), [
        ('CHESS QUEEN', 'CHECKMATE IN THREE', 'at a chess board with a sparkly crown'),
        ('TATI TV', 'NOW STREAMING EVERYWHERE', 'as a TV talk show host with a microphone'),
        ('BURGER CRITIC', 'FIVE STARS. MAYBE FOUR.', 'judging a giant burger with a clipboard'),
        ('THE BIG SISTER', 'IN CHARGE SINCE DAY ONE', 'with her hands on her hips like a superhero'),
        ('CURL POWER', 'NO HUMIDITY CAN STOP HER', 'with glowing gorgeous curls in a hair commercial'),
        ('FUTURE CEO', 'BOARD MEETING AT 3', 'in a fancy office chair behind a big desk'),
        ('STAR OF THE SHOW', 'STANDING OVATION', 'on a theater stage with roses being thrown'),
        ('TACO TUESDAY CHAMP', 'ALL DAYS ARE TACO DAYS', 'holding a giant taco proudly'),
        ('BOOKWORM DELUXE', 'ONE MORE CHAPTER', 'surrounded by towers of books'),
        ('SMILE OF THE YEAR', 'AWARD WINNING', 'holding a golden award statue on a red carpet'),
        ('ROAD TRIP DJ', 'SHE PICKS THE MUSIC', 'wearing big headphones in a van with music notes floating'),
        ('BRAIN POWER', 'SMARTEST IN THE ROOM', 'in front of a chalkboard full of math'),
        ('CHRISTMAS ELF BOSS', 'TOY QUALITY CONTROL', 'in a festive sweater in Santa\'s workshop'),
        ('ADVENTURE TATI', 'TRAIL BLAZER', 'hiking on a Texas trail with a backpack'),
        ('THE CHEF', 'TATI\'S KITCHEN', 'in a chef apron stirring a big pot'),
        ('POP STAR TATI', 'WORLD TOUR 2027', 'singing on a sparkling concert stage'),
    ]),
    'katana': ('Katana, a young teenage girl with braces and dark hair pulled back', pool('katana-face-dinner.jpg', 'picks/katana-20250314_115447.jpg', 'picks/katana-20251108_094228.jpg', 'picks/katana-20250521_161032.jpg', 'katana-face-side.jpg'), [
        ('KATANA', 'CHAMPION OF EVERYTHING', 'holding a giant shiny trophy'),
        ('SNACK CHAMPION', 'UNDEFEATED', 'with a mountain of snacks and a gold medal'),
        ('SILLY FACE QUEEN', 'NOW 100% SILLIER', 'making a cute silly face with her hands on her cheeks'),
        ('THE LITTLE SISTER', 'SHE WINS EVERY ARGUMENT', 'in a judge robe holding a gavel'),
        ('BRACES BRIGHT', 'SMILE POWER: MAXIMUM', 'with a huge sparkling smile in a toothpaste commercial'),
        ('KATANA KART', 'FASTEST ON THE TRACK', 'driving a go-kart with a checkered flag'),
        ('DANCE MACHINE', 'SHE CANNOT BE STOPPED', 'mid dance move under disco lights'),
        ('SALAD SPECIALIST', 'CROUTONS ARE A FOOD GROUP', 'with a giant salad bowl and a happy grin'),
        ('FUTURE ASTRONAUT', 'NEXT STOP: THE MOON', 'in a space suit with the earth behind her'),
        ('BIRTHDAY GIRL', 'IT IS HER DAY', 'with a birthday cake and balloons'),
        ('CAMP KATANA', 'S\'MORES EXPERT', 'by a campfire toasting a marshmallow'),
        ('THE ARTIST', 'MASTERPIECE IN PROGRESS', 'with a paint palette in front of a colorful canvas'),
        ('SOCCER STAR', 'GOOOAL', 'kicking a soccer ball in a stadium'),
        ('KITTY WHISPERER', 'CATS LOVE HER', 'surrounded by friendly cats'),
        ('ROLLER QUEEN', 'WHEELS OF FURY', 'on roller skates at a retro rink'),
        ('KATANA NEWS', 'BREAKING: SHE IS AWESOME', 'as a news anchor at a news desk'),
    ]),
    'jake': ('Jake, a young man', pool('jake-1.png', 'jake-2.png', 'jake-3.png'), [
        ('HANDYMAN JAKE', 'HE BUILT THAT', 'holding a power drill in front of a finished project'),
        ('THE BUILDER', 'MEASURE TWICE, CUT ONCE', 'with a tape measure and a stack of lumber'),
        ('LEVEL UP', 'XP GAINED: HOUSE PROJECT', 'as a video game hero with a glowing level-up banner'),
        ('JAKE OF ALL TRADES', 'MASTER OF MOST', 'wearing a tool belt with a hammer'),
        ('SAWDUST KING', 'IT IS IN HIS HAIR', 'in a workshop with sawdust floating in sunlight'),
        ('MONEY TREE', 'GROWING IT ONE LEAF AT A TIME', 'watering a small cartoon tree with coins as leaves'),
        ('CHORE HERO', 'DISHES: DESTROYED', 'holding a sponge like a sword over a sparkling kitchen'),
        ('THE APPRENTICE', 'LEARNING FROM THE BEST', 'reading a big how-to book with a hard hat on'),
        ('JAKE AND THE BEANSTALK', 'FREE MATERIALS FOUND', 'carrying free wood boards with a grin'),
        ('NIGHT OWL', 'HE GAMES AT DAWN', 'with a gaming headset and glowing screen'),
        ('STRONG MAN JAKE', 'HE LIFTS THE SHEETROCK', 'carrying a big sheet of drywall'),
        ('FUTURE CONTRACTOR', 'NOW HIRING: HIMSELF', 'in front of a small house frame he is building'),
    ]),
    'kai': ('Kai, a five-year-old little boy', pool('kai-1.jpg', 'taylor-kai-bonfire.jpg'), [
        ('KAI THE GREAT', 'AGE 5 AND A HALF', 'wearing a superhero cape on a hilltop'),
        ('DINO EXPERT', 'RAWR MEANS HELLO', 'with friendly cartoon dinosaurs'),
        ('LITTLE BIG MAN', 'CAN DO IT HIMSELF', 'flexing tiny muscles proudly'),
        ('BEDTIME ESCAPE ARTIST', 'JUST ONE MORE STORY', 'in pajamas holding a storybook'),
        ('KAI KART', 'VROOM VROOM', 'in a toy race car'),
        ('BUBBLE BOSS', 'POP POP POP', 'surrounded by giant bubbles in the backyard'),
    ]),
    'snowball': ('Snowball the dog', pool('snowball-1.jpg', 'snowball-2.jpg'), [
        ('WOLF HALL SECURITY', 'BARKS AT NOTHING 24/7', 'wearing tiny aviator sunglasses and a security cap'),
        ('SNOWBALL SPA', 'FLUFF LEVEL: MAXIMUM', 'at a dog spa with a towel on her head'),
        ('NAP INSPECTOR', 'EVERY COUCH TESTED', 'sleeping on a fluffy pillow with a clipboard'),
        ('TREAT DETECTOR', 'SHE KNOWS', 'staring intensely at a cookie jar'),
    ]),
    'leia': ('Leia the dog', pool('leia-1.jpg', 'leia-2.jpg'), [
        ('PRINCESS LEIA', 'ROYAL BELLY RUBS ONLY', 'wearing a tiny crown on a velvet pillow'),
        ('ZOOMIES CHAMPION', 'TOP SPEED: YES', 'running fast across a green yard'),
        ('THE GREETER', 'WELCOME HOME, HUMAN', 'at the front door with a wagging tail'),
        ('BALL IS LIFE', 'THROW IT AGAIN', 'holding a tennis ball proudly'),
    ]),
    'luke': ('Luke the cat', pool('luke-1.jpg', 'luke-2.jpg'), [
        ('LORD LUKE', 'YOU MAY PET ME ONCE', 'sitting on a tiny throne'),
        ('BOX INSPECTOR', 'IF I FITS', 'sitting in a cardboard box'),
        ('NIGHT PATROL', 'THE 3 AM ZOOMIES', 'in a dark hallway with glowing eyes and a tiny flashlight'),
        ('SUNBEAM SPECIALIST', 'NAP IN PROGRESS', 'napping in a warm sunbeam'),
    ]),
}

def keep(desc, human):
    if human:
        return (f'The person is {desc}. Keep their face EXACTLY as in the first photo: same face shape, same eyes, same nose, same smile, '
                'same skin tone, same hair, same age and build. Do not make them older, younger, slimmer or more glamorous: they must be instantly recognizable '
                'to their own family. The second photo is the same person from another angle.')
    return f'This is {desc}. Keep the animal exactly as in the photo: same face, same fur colors and markings, same breed and size.'

def main():
    rnd = random.Random(1124)
    plan = []
    for who, (desc, photos, ideas) in PEOPLE.items():
        human = who not in ('snowball', 'leia', 'luke')
        for i, (title, line, scene) in enumerate(ideas):
            style = 'A' if i % 2 == 0 else 'B'
            p1 = photos[i % len(photos)]; p2 = photos[(i + 1) % len(photos)]
            if style == 'A':
                prompt = (f'Turn this photo into a fun, bright 1980s Saturday-morning TV commercial still. {keep(desc, human)} '
                          f'Show them {scene}, large and centered in the frame, face clearly visible. Big bold retro title text reads: {title}. '
                          f'One short line under it reads: {line}. No other text. Warm, kind, family-friendly.')
            else:
                prompt = (f'Keep this photo realistic, like a real photograph. {keep(desc, human)} Show them {scene}, on a glossy TV commercial set with soft studio lights, '
                          f'large in the frame with the face clearly visible. Add big bold title text at the top: {title}. One short line at the bottom: {line}. No other text. Fun and kind.')
            plan.append({'name': f'{who}-{i + 1:02d}', 'who': who, 'style': style, 'title': title, 'line': line, 'photos': [p1] + ([p2] if p2 != p1 else []), 'prompt': prompt, 'seed': rnd.randint(1, 2**31)})
    out = os.path.join(ROOT, 'data/commercials/plan.json')
    json.dump(plan, open(out, 'w'), indent=1)
    print(len(plan), 'slides planned ->', out)

if __name__ == '__main__':
    main()
