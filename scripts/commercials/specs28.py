# The 28 family commercials (Horace 11/24: "make the 28 commercials with fast mode"). Writes one spec per spot into
# data/commercials/specs/ (git-ignored with the rest of data/). Kind and funny, family-only, private to the house TV.
# Never money, bills, health or anything private. One photo per spot: a second photo of the same person adds a second person.
import json, os

ROOT = '/mnt/c/Users/Owner/Documents/watson'
P = 'data/family-photos/'

def person(name, desc, pron):
    he, his = pron
    return (f"The {desc.split(',')[0]} is {name}, {desc.split(',', 1)[1].strip()}. Keep {his} face EXACTLY as in the photo: same face shape, eyes, nose, "
            f"smile, skin tone, hair, age and build. Do not make {he} older, younger, slimmer or more glamorous: {he} must be instantly recognizable to the family.")

def pet(name, kind):
    return f"This is {name} the {kind}. Keep the animal exactly as in the photo: same face, same fur colors and markings, same breed and size."

H = ('Horace', P + 'picks/horace-20260830_121459.jpg', person('Horace', 'man, a bearded man with glasses', ('he', 'his')), 'person')
T = ('Taylor', P + 'picks/taylor-20250513_193420.jpg', person('Taylor', 'man, a bearded man', ('he', 'his')), 'person')
TA = ('Tatiyana', P + 'picks/tati-20250316_152334.jpg', person('Tatiyana', 'girl, a teenage girl with curly dark hair', ('she', 'her')), 'person')
K = ('Katana', P + 'katana-face-dinner.jpg', person('Katana', 'girl, a young teenage girl with braces and dark hair pulled back', ('she', 'her')), 'person')
J = ('Jake', P + 'jake-1.png', person('Jake', 'man, a young man', ('he', 'his')), 'person')
KA = ('Kai', P + 'kai-1.jpg', person('Kai', 'boy, a five-year-old little boy', ('he', 'his')), 'person')
L = ('Leia', P + 'leia-1.jpg', pet('Leia', 'dog'), 'dog')
S = ('Snowball', P + 'snowball-1.jpg', pet('Snowball', 'dog'), 'dog')
LU = ('Luke', P + 'luke-1.jpg', pet('Luke', 'cat'), 'cat')

TRAILER = 'epic cinematic movie trailer, orchestral, big drums, brass, heroic, instrumental'
EIGHTIES = 'upbeat cheesy 1980s TV infomercial jingle, bright synth, claps, cheerful, retro, instrumental'
MATRIX = 'dark electronic cyberpunk trailer, pulsing synth bass, glitchy, dramatic, instrumental'
COUNTRY = 'upbeat country jingle, banjo, fiddle, acoustic guitar, foot stomping, cheerful, instrumental'
GAMESHOW = 'upbeat happy game show jingle, bright synth, claps, cheerful, retro 80s TV, instrumental'
CUTE = 'playful cute cartoon jingle, xylophone, ukulele, whistles, happy, instrumental'

SPOTS = [
 # name, who, voice, title, punch, music, [(scene, motion) x3], [line x3]
 ('ad-horace-neo', H, 'trinity', "NEO'S COMMAND CENTER", 'THERE IS NO SPOON. THERE IS AN APP.', MATRIX,
  [('He sits at a desk in a dark room lit by glowing green computer screens, wearing a long black coat, calm confident smile.', 'green light flickers across his face as he leans toward the screens and smiles'),
   ('He stands in a dark hallway in a long black coat and dark sunglasses pushed up on his head, green digital rain glowing behind him.', 'he slowly turns toward the camera as green digital rain falls behind him'),
   ('He leans back in a big chair with his hands behind his head, glowing green screens around him, very pleased.', 'he leans back, laces his fingers behind his head and grins')],
  ['In a world of a thousand to-do lists...', 'one man built an app for all of them.', "Horace. Neo's command center. Now loading."]),
 ('ad-smoke-shack', H, 'pappy', 'THY SMOKE SHACK', 'COMING SOON. LOW AND SLOW.', TRAILER,
  [('He stands proudly in front of a rustic wooden smokehouse in the country at golden hour, smoke curling from the chimney.', 'smoke curls up from the chimney as he crosses his arms and smiles proudly'),
   ('He opens a big black barbecue smoker and a cloud of smoke rolls out around him, golden evening light.', 'he lifts the smoker lid and smoke rolls out around him'),
   ('He sits on a porch bench beside the wooden smokehouse at sunset holding a plate of barbecue, content smile.', 'he lifts the plate a little and nods slowly as the sun sets')],
  ['Well now. Out past the trees, a legend is buildin\'.', 'Low and slow, the way the good Lord intended.', 'Thy Smoke Shack. Comin\' soon. Bring a fork.']),
 ('ad-horace-lists', H, 'oracle', 'THE LIST MAKER', 'HE HAS A LIST FOR HIS LISTS', EIGHTIES,
  [('He holds up a very long paper list that unrolls all the way to the floor, in a bright 1980s TV studio.', 'the long paper list unrolls down to the floor as he holds it up proudly'),
   ('He sits at a kitchen table covered in sticky notes in every color, holding a pen, delighted.', 'he sticks one more sticky note on the table and grins'),
   ('He stands in a bright 1980s TV studio giving a big thumbs up, sparkles in the air.', 'he gives a big thumbs up as sparkles twinkle around him')],
  ['Tired of forgetting things? Horace is not.', 'He has a list for groceries. A list for chores. A list for lists.', 'The List Maker. Order now. He already wrote it down.']),
 ('ad-horace-lights', H, 'oracle', 'CHRISTMAS LIGHTS KING', 'VISIBLE FROM SPACE', EIGHTIES,
  [('He stands on a ladder hanging bright Christmas lights on a cozy house at dusk.', 'he hangs a string of glowing lights on the roof edge as they twinkle'),
   ('He stands in front of a house covered in thousands of glowing Christmas lights at night, arms wide.', 'he spreads his arms wide as the Christmas lights twinkle brightly'),
   ('He holds a giant tangled ball of Christmas lights and laughs, in a cozy living room.', 'he laughs and holds up the tangled ball of glowing lights')],
  ['This holiday season, one man has a dream.', 'More lights. Brighter lights. All the lights.', 'Horace. Christmas lights king. Visible from space.']),
 ('ad-horace-jokes', H, 'workshop-oracle', 'DAD JOKE DELUXE', 'NOW 50% CORNIER', EIGHTIES,
  [('He stands on a small comedy club stage holding a microphone under a warm spotlight, red curtain behind him.', 'he tells a joke into the microphone and grins under the spotlight'),
   ('He laughs at his own joke on the comedy stage, one hand on his belly, spotlight on him.', 'he throws his head back laughing at his own joke'),
   ('He takes a bow on the comedy stage as the spotlight shines on him.', 'he takes a deep bow under the spotlight and smiles')],
  ['Live, for one night only. And every night after.', 'He has heard your groans. He does not care.', 'Horace. Dad joke deluxe. Now fifty percent cornier.']),
 ('ad-taylor-ribs', T, 'pappy', 'RIB KING', 'NAPKINS NOT INCLUDED', COUNTRY,
  [('He stands at a big outdoor barbecue grill flipping ribs with tongs, smoke rising, sunny backyard.', 'he flips the ribs with the tongs as smoke rises'),
   ('He sits at a picnic table in front of a huge platter of barbecue ribs, big happy grin.', 'he rubs his hands together and grins at the platter of ribs'),
   ('He holds up a rib proudly at the picnic table like a trophy, sunny backyard.', 'he raises the rib high like a trophy and laughs')],
  ['Well howdy. Folks come from miles for this.', 'Taylor don\'t eat ribs. He conquers \'em.', 'Taylor. Rib King. Napkins not included.']),
 ('ad-taylor-cowboys', T, 'oracle', 'COWBOYS FAN NO. 1', "HOW 'BOUT THEM COWBOYS", TRAILER,
  [('He sits on a couch in a navy blue football jersey and cap, leaning forward toward a big TV, excited.', 'he leans forward on the couch and clenches his fists in excitement'),
   ('He jumps up from the couch cheering with both arms raised, navy blue jersey and cap.', 'he jumps up and throws both arms in the air cheering'),
   ('He stands in a stadium crowd in a navy blue jersey and cap, cheering with a foam finger.', 'he waves the foam finger and cheers with the crowd')],
  ['Every Sunday, one man gives it everything.', 'He yells. He paces. He believes.', 'Taylor. Fan number one. How about them Cowboys.']),
 ('ad-taylor-fishing', T, 'trinity', 'FISHING LEGEND', 'IT WAS THIS BIG', COUNTRY,
  [('He stands on a wooden dock at a calm lake at sunrise holding a fishing rod.', 'he casts the fishing line out over the calm lake'),
   ('He sits in a small boat on the lake, fishing rod bent, laughing with surprise.', 'the rod bends and he laughs as he reels in'),
   ('He holds his hands far apart on the dock showing how big the fish was, big grin, sunrise behind him.', 'he spreads his hands wider and wider apart and grins')],
  ['Some men fish. Taylor tells stories.', 'And every story, the fish gets a little bigger.', 'Taylor. Fishing legend. It was this big.']),
 ('ad-taylor-dad', T, 'trinity', 'DAD OF THE YEAR', 'JAKE AND KAI APPROVED', TRAILER,
  [('He stands in a warm backyard at golden hour holding a football, smiling kindly.', 'he tosses the football gently and smiles'),
   ('He holds a shiny gold trophy at chest height on a stage with warm lights, his whole face visible, big smile.', 'he raises the trophy a little and smiles warmly'),
   ('He sits by a cozy campfire at night, smiling, warm firelight on his face.', 'the firelight flickers and he smiles and nods')],
  ['Up before the sun. Home with a smile.', 'He works hard. He loves harder.', 'Taylor. Dad of the year. Jake and Kai approved.']),
 ('ad-tati-chess', TA, 'oracle', 'CHESS QUEEN', 'CHECKMATE IN THREE', TRAILER,
  [('She sits at a wooden chess board in a cozy room, studying the pieces with a confident smile.', 'she studies the chess board and slowly smiles'),
   ('She moves a chess piece with one finger, a sly confident grin, warm light.', 'she slides a chess piece forward and grins'),
   ('She leans back with her arms crossed beside the chess board, a winner\'s smile.', 'she crosses her arms and smiles like a champion')],
  ['She sees the whole board. Three moves ahead.', 'Her opponents never see it coming.', 'Tatiyana. Chess queen. Checkmate in three.']),
 ('ad-tati-kitchen', TA, 'pappy', "TATI'S KITCHEN", 'NOW SERVING', COUNTRY,
  [('She stands at a stove in a bright kitchen wearing an apron, stirring a big pot, steam rising.', 'she stirs the pot as steam rises and smiles'),
   ('She tastes from a wooden spoon in the kitchen, eyes wide with delight.', 'she tastes from the wooden spoon and her eyes light up'),
   ('She presents a beautiful plate of food with both hands in the kitchen, proud smile.', 'she holds out the plate proudly and smiles')],
  ['Well I\'ll be. Somebody\'s cookin\' in my kitchen.', 'And I gotta say, she might be better than ol\' Pappy.', "Tati's Kitchen. Now servin'. Come hungry."]),
 ('ad-tati-popstar', TA, 'trinity', 'POP STAR TATI', 'WORLD TOUR 2027', GAMESHOW,
  [('She stands on a big concert stage in a sparkly outfit holding a microphone, colorful lights.', 'she sings into the microphone as colorful stage lights sweep'),
   ('She waves to a huge cheering crowd from the concert stage, confetti in the lights.', 'she waves to the crowd as confetti floats down'),
   ('She strikes a pose on the concert stage with one hand up, spotlight on her.', 'she strikes a pose and smiles under the spotlight')],
  ['One voice. One stage. One superstar.', 'The crowd knows every word.', 'Tati. World tour, twenty twenty-seven.']),
 ('ad-tati-books', TA, 'trinity', 'BOOKWORM DELUXE', 'ONE MORE CHAPTER', CUTE,
  [('She sits in a cozy reading nook surrounded by tall stacks of books, reading with a smile.', 'she turns a page and smiles'),
   ('She reads under a blanket with a flashlight late at night, totally absorbed.', 'she turns a page under the blanket by flashlight'),
   ('She stands in a giant library holding an open book to her chest, happy.', 'she hugs the book to her chest and smiles')],
  ['It\'s late. The lights are out.', 'But she just has to know what happens next.', 'Tatiyana. Bookworm deluxe. Just one more chapter.']),
 ('ad-katana-champ', K, 'trinity', 'KATANA', 'CHAMPION OF EVERYTHING', GAMESHOW,
  [('She walks onto a bright TV game show stage with colorful lights, waving and smiling.', 'she waves happily at the audience and smiles as the stage lights twinkle'),
   ('She holds a shiny gold trophy low at her waist with both hands on the game show stage, her whole face visible, big smile with braces.', 'she lifts the trophy a little and laughs'),
   ('She takes a bow on the game show stage while soft confetti drifts down slowly.', 'she takes a little bow and smiles as confetti drifts down')],
  ['She is kind. She is funny. She is very, very good at snacks.', 'And today, she is taking home the big one.', 'Katana. Champion of everything. We are so proud of you.']),
 ('ad-katana-soccer', K, 'oracle', 'SOCCER STAR', 'GOOOAL', TRAILER,
  [('She runs across a green soccer field dribbling a ball, sunny day.', 'she dribbles the soccer ball across the field'),
   ('She kicks a soccer ball toward a goal, determined face, sunny field.', 'she kicks the ball hard toward the goal'),
   ('She celebrates on the soccer field with both arms raised, huge smile with braces.', 'she throws her arms up and cheers')],
  ['The field. The ball. The moment.', 'She doesn\'t just play. She flies.', 'Katana. Soccer star. Goooal.']),
 ('ad-katana-dance', K, 'trinity', 'DANCE MACHINE', 'SHE CANNOT BE STOPPED', GAMESHOW,
  [('She dances on a glowing disco dance floor with colorful lights.', 'she dances happily as the disco floor lights change color'),
   ('She spins on the dance floor with her arms out, big smile, colorful lights.', 'she spins around with her arms out and laughs'),
   ('She strikes a fun dance pose on the glowing dance floor, smiling with braces.', 'she strikes a fun pose and grins')],
  ['Warning. When the music starts...', 'she cannot be stopped.', 'Katana. The dance machine.']),
 ('ad-katana-space', K, 'oracle', 'FUTURE ASTRONAUT', 'NEXT STOP: THE MOON', TRAILER,
  [('She stands in a white astronaut suit holding her helmet under one arm, a rocket behind her, big smile.', 'she smiles and waves as the rocket steams behind her'),
   ('She floats inside a spaceship in a white astronaut suit, the Earth in the window behind her, delighted.', 'she floats gently and laughs as the Earth turns in the window'),
   ('She stands on the moon in a white astronaut suit with the helmet visor up, waving, the Earth in the sky.', 'she waves from the moon as the Earth glows above')],
  ['Ten. Nine. Eight...', 'One small step for Katana.', 'Future astronaut. Next stop, the moon.']),
 ('ad-jake-express', J, 'workshop-oracle', 'WOLF HALL EXPRESS', 'YOU CALL. HE DRIVES.', EIGHTIES,
  [('He sits behind the wheel of a car with one arm out the window, sunglasses on his head, ready to go.', 'he taps the steering wheel and grins'),
   ('He carries grocery bags up to a front door, smiling, sunny day.', 'he walks up to the door with the grocery bags and smiles'),
   ('He gives a thumbs up beside a car in a driveway, sunny day.', 'he gives a big thumbs up and nods')],
  ['Need a ride? Need a run to the store?', 'One call, and he\'s already in the car.', 'Wolf Hall Express. You call. Jake drives.']),
 ('ad-jake-builder', J, 'workshop-oracle', 'HANDYMAN JAKE', 'HE BUILT THAT', TRAILER,
  [('He stands in a wooden house frame under construction wearing a tool belt, holding a drill.', 'he lifts the drill and grins'),
   ('He carries a stack of wooden boards on his shoulder at a construction site, sunny day.', 'he carries the boards across the site'),
   ('He stands proudly with his hands on his hips in front of a finished wooden deck.', 'he puts his hands on his hips and smiles proudly')],
  ['Walls. Floors. Whatever it takes.', 'Measure twice. Cut once. Build forever.', 'Handyman Jake. He built that.']),
 ('ad-jake-nightowl', J, 'workshop-oracle', 'NIGHT OWL', 'HE GAMES AT DAWN', MATRIX,
  [('He sits in a dark room lit by a glowing blue gaming screen, wearing a headset, focused.', 'blue light flickers on his face as he leans in'),
   ('He leans back in a gaming chair with his arms raised in victory, glowing screens around him.', 'he throws his arms up in victory'),
   ('He looks out a window at sunrise with a headset around his neck, surprised it is morning.', 'he looks out at the sunrise and blinks in surprise')],
  ['When the house is asleep...', 'one hero is just getting started.', 'Jake. Night owl. Is that the sun?']),
 ('ad-kai-weekend', KA, 'trinity', "KAI'S BIG WEEKEND", 'AGE 5 AND A HALF', CUTE,
  [('He runs across a sunny green yard with his arms out like an airplane.', 'he runs across the yard with his arms out like an airplane'),
   ('He sits on a swing in a sunny park, laughing.', 'he swings back and forth and laughs'),
   ('He sits on a picnic blanket eating a giant slice of watermelon, big smile.', 'he takes a big bite of watermelon and grins')],
  ['This weekend, one little man has big plans.', 'Running. Swinging. Snacks. Lots of snacks.', "Kai's big weekend. Age five and a half."]),
 ('ad-kai-hero', KA, 'oracle', 'KAI THE GREAT', 'CAN DO IT HIMSELF', TRAILER,
  [('He stands on a sunny hill wearing a red superhero cape, hands on his hips.', 'his cape flutters as he stands with hands on hips'),
   ('He runs across a field in a red superhero cape, the cape flying behind him.', 'he runs as the red cape flies behind him'),
   ('He flexes his little arms like a strongman in a red cape, proud smile.', 'he flexes his arms and smiles proudly')],
  ['Faster than a bedtime. Stronger than broccoli.', 'He can do it himself. Every time.', 'Kai the Great.']),
 ('ad-leia-zoomies', L, 'oracle', 'ZOOMIES CHAMPION', 'TOP SPEED: YES', CUTE,
  [('The dog runs at full speed across a green yard, ears flying.', 'the dog races across the yard with ears flying'),
   ('The dog skids to a stop in the grass with her tongue out, happy.', 'the dog skids to a stop and pants happily'),
   ('The dog sits proudly in the yard wearing a tiny gold medal.', 'the dog wags her tail and tilts her head')],
  ['Three in the afternoon. Nothing happened.', 'And yet, she must run.', 'Leia. Zoomies champion.']),
 ('ad-leia-greeter', L, 'trinity', 'THE GREETER', 'WELCOME HOME, HUMAN', CUTE,
  [('The dog waits by a front door with her tail wagging, warm light.', 'the dog wags her tail by the door'),
   ('The dog jumps up happily as the front door opens, warm light.', 'the dog jumps up happily as the door opens'),
   ('The dog lies on a cozy rug looking content.', 'the dog rests her head on her paws and sighs happily')],
  ['Gone five minutes? Gone five hours?', 'Doesn\'t matter. You\'re home.', 'Leia. The greeter. Welcome home.']),
 ('ad-snowball-spa', S, 'trinity', 'SNOWBALL SPA', 'FLUFF LEVEL: MAXIMUM', CUTE,
  [('The fluffy white dog wrapped in a soft towel at a cozy spa, looking relaxed.', 'the dog blinks slowly in the soft towel'),
   ('The fluffy white dog being gently brushed, eyes half closed, very happy.', 'the dog closes her eyes as she is brushed'),
   ('The fluffy white dog sitting on a velvet pillow, extremely fluffy and proud.', 'the dog lifts her chin proudly on the pillow')],
  ['Welcome to the spa.', 'Today\'s treatment: maximum fluff.', 'Snowball. Fluff level, maximum.']),
 ('ad-snowball-treats', S, 'oracle', 'TREAT DETECTOR', 'SHE KNOWS', CUTE,
  [('The fluffy white dog sits in a kitchen staring up at a cookie jar on the counter.', 'the dog stares at the cookie jar and tilts her head'),
   ('The fluffy white dog with her nose to the floor, sniffing like a detective.', 'the dog sniffs along the floor like a detective'),
   ('The fluffy white dog sits politely with a dog biscuit in front of her, delighted.', 'the dog wags her tail at the biscuit')],
  ['You opened a bag. Three rooms away.', 'She heard it. She knows.', 'Snowball. Treat detector.']),
 ('ad-luke-lives', LU, 'pappy', 'LUKE: NINE LIVES', 'YOU MAY PET HIM ONCE', TRAILER,
  [('The cat sits on a red velvet throne like a king, regal stare.', 'the cat slowly blinks on the throne'),
   ('The cat walks slowly down a hallway like he owns the place, dramatic light.', 'the cat walks slowly toward the camera'),
   ('The cat naps in a warm sunbeam on the floor, perfectly content.', 'the cat stretches in the sunbeam and curls up')],
  ['He was here first. Or so he says.', 'Nine lives. Not one of \'em in a hurry.', 'Luke. You may pet him once.']),
 ('ad-luke-box', LU, 'oracle', 'BOX INSPECTOR', 'IF I FITS', CUTE,
  [('The cat sits inside a cardboard box, only his head peeking out.', 'the cat peeks out of the box and blinks'),
   ('The cat squeezes into a box that is clearly too small, looking satisfied.', 'the cat wiggles further into the small box'),
   ('The cat sits proudly on top of a stack of cardboard boxes.', 'the cat looks around from the top of the boxes')],
  ['A new box has arrived.', 'It must be inspected. Thoroughly.', 'Luke. Box inspector. If I fits, I sits.']),
]

os.makedirs(os.path.join(ROOT, 'data/commercials/specs'), exist_ok=True)
for i, (name, who, voice, title, punch, music, scenes, lines) in enumerate(SPOTS):
    nm, photo, keep, kind = who
    spec = {'name': name, 'voice': voice, 'photos': [photo], 'keep': keep, 'kind': kind, 'seed': 5000 + i * 10,
            'scenes': [{'prompt': (s if kind != 'person' else s), 'motion': m} for s, m in scenes],
            'lines': [{'at': at, 'text': t} for at, t in zip((0.6, 5.6, 10.6), lines)],
            'title': title, 'punch': punch, 'music': {'tags': music, 'lyrics': '[instrumental]'}}
    json.dump(spec, open(os.path.join(ROOT, 'data/commercials/specs', name.replace('ad-', '') + '.json'), 'w'), indent=1)
print(len(SPOTS), 'specs')
