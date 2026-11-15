/**
 * Word pairs the oracle comparison accepts as one word in different dress
 * (issue #85). Each pair was seen in the comparison of the whole corpus and
 * checked by hand; a pair not listed here is a different word, which only
 * the page image can decide. A rule would be shorter, but every rule tried
 * ("our" for "or", a dropped "-est") also joined different words: four and
 * for, forest and for, lowest and low.
 */

// The transcription modernises the edition's archaic forms where the archaic word is also, or is close to, a modern
// one, so these hold only as pairs: "saith" is "said" or "says", but "said" is never "says"
const MODERNISED = [
    'saith said', 'saith says', 'art are', 'ere before', 'sate sat', 'thine your', 'thine yours', 'brake broke', 'bare bore', 'gat got', 'spat spit', 'hence here',
];

// British and American spelling, the edition's ligatures and older spellings (honour, Judaea, stedfast, fulfil)
const SPELLING = [
    'alpheus alphaeus', 'apparelled appareled', 'ardour ardor', 'arimathaea arimathea', 'armour armor', 'bactroperate bactroperatae', 'bartimeus bartimaeus', 'befal befall',
    'befals befalls', 'behaviour behavior', 'cancelled canceled', 'cavillers cavilers', 'cena caena', 'centre center', 'cesar caesar', 'cesarea caesarea',
    'cesars caesars', 'chananean chananaean', 'chananeans chananaeans', 'chananeus chananaeus', 'clamour clamor', 'clamours clamors', 'colour color', 'colours colors',
    'counsellor counselor', 'daemon demon', 'daemoniac demoniac', 'daemons demons', 'defence defense', 'dishonour dishonor', 'dishonourable dishonorable', 'dishonoured dishonored',
    'dulness dullness', 'elius aelius', 'endeavour endeavor', 'endeavoured endeavored', 'endeavouring endeavoring', 'endeavours endeavors', 'enquire inquire', 'enquired inquired',
    'enquirer inquirer', 'enquires inquires', 'enquiries inquiries', 'enquiring inquiring', 'enquiry inquiry', 'enrol enroll', 'enrolment enrollment', 'equalling equaling',
    'euchite euchitae', 'favour favor', 'favourable favorable', 'favoured favored', 'favourers favorers', 'favours favors', 'feces faeces', 'fervour fervor',
    'foretel foretell', 'foretels foretells', 'fulfil fulfill', 'fulfilment fulfillment', 'fulfils fulfills', 'galilaeans galileans', 'galilean galilaean', 'grovelling groveling',
    'harbour harbor', 'harbours harbors', 'honour honor', 'honourable honorable', 'honourably honorably', 'honoured honored', 'honouring honoring', 'honours honors',
    'humour humor', 'idumean idumaean', 'instil instill', 'iturea ituraea', 'judaea judea', 'labour labor', 'laboured labored', 'labourer laborer',
    'labourers laborers', 'labouring laboring', 'labours labors', 'licence license', 'lustre luster', 'manichaeans manicheans', 'manicheus manichaeus', 'marvelled marveled',
    'marvelling marveling', 'marvellous marvelous', 'merchandize merchandise', 'neighbour neighbor', 'neighbourhood neighborhood', 'neighbouring neighboring', 'neighbours neighbors', 'odour odor',
    'odours odors', 'offence offense', 'offences offenses', 'pourtrayed portrayed', 'pourtrays portrays', 'preparatio praeparatio', 'pretence pretense', 'recal recall',
    'recals recalls', 'recognise recognize', 'recognised recognized', 'recognises recognizes', 'recognising recognizing', 'revellings revelings', 'rigour rigor', 'rivalling rivaling',
    'rumour rumor', 'rumours rumors', 'saviour savior', 'saviours saviors', 'savour savor', 'savoured savored', 'savouring savoring', 'sceptre scepter',
    'sepulchre sepulcher', 'skilful skillful', 'splendour splendor', 'stedfast steadfast', 'stedfastly steadfastly', 'stedfastness steadfastness', 'succour succor', 'succoured succored',
    'succouring succoring', 'succours succors', 'thaddaeus thaddeus', 'toilless toiless', 'tranquillity tranquility', 'traveller traveler', 'travellers travelers', 'travelling traveling',
    'vapour vapor', 'vigour vigor', 'wilful willful', 'wilfully willfully', 'zaccheus zacchaeus',
];

// The edition's third person in -eth against the transcription's -s
const THIRD_PERSON = [
    'abideth abides', 'accompanieth accompanies', 'accomplisheth accomplishes', 'accuseth accuses', 'advanceth advances', 'agreeth agrees', 'appeareth appears', 'appertaineth appertains',
    'ascendeth ascends', 'asketh asks', 'availeth avails', 'baptizeth baptizes', 'beareth bears', 'becometh becomes', 'beholdeth beholds', 'believeth believes',
    'belongeth belongs', 'betrayeth betrays', 'blasphemeth blasphemes', 'bloweth blows', 'bringeth brings', 'careth cares', 'casteth casts', 'ceaseth ceases',
    'changeth changes', 'cleanseth cleanses', 'climbeth climbs', 'cometh comes', 'comforteth comforts', 'consisteth consists', 'containeth contains', 'continueth continues',
    'convinceth convinces', 'covereth covers', 'creepeth creeps', 'crieth cries', 'cumbereth cumbers', 'cureth cures', 'deceiveth deceives', 'declareth declares',
    'decreaseth decreases', 'delayeth delays', 'denieth denies', 'departeth departs', 'dependeth depends', 'deserveth deserves', 'desireth desires', 'destroyeth destroys',
    'dieth dies', 'displeaseth displeases', 'doeth does', 'draweth draws', 'drinketh drinks', 'driveth drives', 'dwelleth dwells', 'eateth eats',
    'edifieth edifies', 'endureth endures', 'enlighteneth enlightens', 'entereth enters', 'exalteth exalts', 'extolleth extols', 'faileth fails', 'feareth fears',
    'feedeth feeds', 'findeth finds', 'fleeth flees', 'followeth follows', 'forgiveth forgives', 'forsaketh forsakes', 'gathereth gathers', 'giveth gives',
    'glorieth glories', 'glorifieth glorifies', 'goeth goes', 'grieveth grieves', 'groaneth groans', 'hangeth hangs', 'hateth hates', 'heareth hears',
    'hideth hides', 'honoureth honors', 'humbleth humbles', 'hurteth hurts', 'increaseth increases', 'intercedeth intercedes', 'judgeth judges', 'justifieth justifies',
    'keepeth keeps', 'knocketh knocks', 'knoweth knows', 'layeth lays', 'leadeth leads', 'leaveneth leavens', 'leaveth leaves', 'lieth lies',
    'lighteneth lightens', 'listeth lists', 'liveth lives', 'looketh looks', 'looseth looses', 'loveth loves', 'lusteth lusts', 'maketh makes',
    'manifesteth manifests', 'marrieth marries', 'meaneth means', 'needeth needs', 'openeth opens', 'ordereth orders', 'panteth pants', 'passeth passes',
    'perisheth perishes', 'pertaineth pertains', 'pitieth pities', 'possesseth possesses', 'poureth pours', 'prayeth prays', 'presseth presses', 'proceedeth proceeds',
    'profiteth profits', 'prophesieth prophesies', 'puffeth puffs', 'quickeneth quickens', 'reapeth reaps', 'receiveth receives', 'reigneth reigns', 'rejecteth rejects',
    'rejoiceth rejoices', 'remaineth remains', 'remembereth remembers', 'repenteth repents', 'requireth requires', 'resisteth resists', 'ruleth rules', 'scattereth scatters',
    'searcheth searchs', 'searcheth searches', 'seduceth seduces', 'seeketh seeks', 'seemeth seems', 'seeth sees', 'sendeth sends', 'separateth separates',
    'serveth serves', 'shineth shines', 'sleepeth sleeps', 'soundeth sounds', 'soweth sows', 'speaketh speaks', 'springeth springs', 'standeth stands',
    'stinketh stinks', 'strengtheneth strengthens', 'stumbleth stumbles', 'sufficeth suffices', 'taketh takes', 'talketh talks', 'teacheth teaches', 'tempteth tempts',
    'tendeth tends', 'testifieth testifies', 'thinketh thinks', 'thirsteth thirsts', 'throweth throws', 'toucheth touches', 'trieth tries', 'troubleth troubles',
    'trusteth trusts', 'understandeth understands', 'useth uses', 'usurpeth usurps', 'waiteth waits', 'walketh walks', 'wasteth wastes', 'wisheth wishes',
    'withereth withers', 'witnesseth witnesses', 'worketh works', 'yearneth yearns', 'yieldeth yields',
];

// The edition's second person in -est or -st, which the transcription drops
const SECOND_PERSON = [
    'acceptest accept', 'acknowledgest acknowledge', 'admiredst admired', 'affordest afford', 'amongst among', 'answerest answer', 'approachest approach', 'ascribest ascribe',
    'askest ask', 'awakest awake', 'baptizedst baptized', 'baptizest baptize', 'bearest bear', 'beholdest behold', 'believest believe', 'betrayest betray',
    'blasphemest blaspheme', 'boastest boast', 'bringest bring', 'broughtest brought', 'camest came', 'castest cast', 'clamourest clamor', 'comest come',
    'commandest command', 'comprehendest comprehend', 'confessest confess', 'courtest court', 'deceivest deceive', 'delightedst delighted', 'despairest despair', 'detractest detract',
    'didst did', 'disputest dispute', 'drivest drive', 'errest err', 'fearedst feared', 'findest find', 'forgivest forgive', 'foundest found',
    'gavest gave', 'girdedst girded', 'givest give', 'goest go', 'graspest grasp', 'hadst had', 'heardest heard', 'hearest hear',
    'hoardest hoard', 'holdest hold', 'judgest judge', 'knewest knew', 'knowest know', 'lackest lack', 'liest lie', 'livest live',
    'lookest look', 'losest lose', 'lovest love', 'madest made', 'makest make', 'marvellest marvel', 'mightest might', 'needest need',
    'neglectest neglect', 'oughtest ought', 'owest owe', 'pardonest pardon', 'passest pass', 'payest pay', 'perceivest perceive', 'persecutest persecute',
    'pollutest pollute', 'possessest possess', 'prayest pray', 'preachest preach', 'presumest presume', 'proclaimest proclaim', 'readest read', 'receivedst received',
    'receivest receive', 'refusedst refused', 'refusest refuse', 'regardest regard', 'rejoicest rejoice', 'reproachest reproach', 'returnedst returned', 'rulest rule',
    'sawest saw', 'seekest seek', 'seemest seem', 'seest see', 'shrinkest shrink', 'smartedst smarted', 'smitest smite', 'speakest speak',
    'spendest spend', 'standest stand', 'stealest steal', 'stumblest stumble', 'supposest suppose', 'takest take', 'talkest talk', 'teachest teach',
    'thinkest think', 'thoughtest thought', 'throwest throw', 'tookest took', 'treadest tread', 'turnest turn', 'understandest understand', 'upbraidest upbraid',
    'usest use', 'usurpest usurp', 'utterest utter', 'walkedst walked', 'walkest walk', 'wanderest wander', 'weepest weep', 'wentest went',
    'wishest wish', 'wonderest wonder', 'workest work',
];

export const WORD_VARIANTS: ReadonlySet<string> = new Set([...MODERNISED, ...SPELLING, ...THIRD_PERSON, ...SECOND_PERSON].flatMap((p) => [p, p.split(' ').reverse().join(' ')]));
