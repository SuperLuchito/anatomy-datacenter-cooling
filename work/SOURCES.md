# Проверка по первоисточникам (11.10.2026)

Сеть контейнера не пропускает vertiv.com (ответ прокси 403), поэтому PDF прочитан через веб-инструмент Exa.

## Vertiv Liebert HPM A/W/F/D/H User Manual, cod. 265011, rev. 23.01.2018

https://www.vertiv.com/48d574/globalassets/products/thermal-management/room-cooling/vertiv-liebert-hpm/vertiv-liebert_hpm-um-en-emea-265011.pdf

Подтверждено в разделе 2.1.4 (Version F, Freecooler units):
- воздух охлаждается одним теплообменником (5): ряды прямого испарения хладагента или ряды фрикулинга (вода/гликоль);
- «whenever the outdoor temperature is at least 5 degrees below the indoor return temperature» жидкость охлаждается
  внешним Dry Cooler (10) и проходит через теплообменник (5);
- выше ZET (Zero Energy Temperature) жидкость обменивается теплом с хладагентом в водяном пластинчатом конденсаторе (2);
  ниже ZET жидкость охлаждена настолько, что охлаждает воздух прямо в рядах фрикулинга;
- замкнутый контур с внешним драйкулером, рекомендуется водно-гликолевая смесь;
- циркуляция принудительная, насос (11) и смесь в поставку не входят;
- 2-ходовой модулирующий клапан (12) регулирует расход через водно-гликолевый теплообменник;
- соленоидный клапан (13) пропускает воду к конденсатору.

Соседний раздел 2.1.3 (Version W): паяный пластинчатый конденсатор из нержавеющей стали с клапаном регулирования
давления конденсации (8); драйкулеры — опция, насос и смесь обычно поставляются другими. Клапан (8) в описании F
текстом не упомянут, поэтому на сцене не показан.

Раздел 2.1.1 (общий холодильный контур): компрессор → конденсатор → ресивер → терморегулирующий клапан → испаритель.
Таблица пределов: «For W, F and H units — water or mixture temperature to condenser, lower limit min. 5 °C».
Таблица конфигураций: U / UNDER — Downflow (подача вниз, под фальшпол).

## Liebert HPD (наружный сухой охладитель)

https://www.vertiv.com/en-us/products-catalog/thermal-management/heat-rejection/liebert-hpd/

Подтверждено: наружные блоки, отводящие тепло от водоохлаждаемых DX-кондиционеров (вода или гликолевая смесь
до 40 %); модулирующее регулирование скорости вентиляторов, вариант с двумя уставками для режима фрикулинга;
теплообменник из овальных медных трубок; горизонтальная или вертикальная установка.

Не нашёл подтверждения на 11.10.2026: наличие или отсутствие орошения у HPD. Отсутствие испарительного орошения —
допущение сцены.

## Что взято из задания, а не из источников

Все коэффициенты модели (22 °C, 4 и 8 кВт/К, ε = 0,7, UA = 12 кВт/К, COP = 3, 6 °C), компоновка узлов, размеры,
скорости маркеров и вентиляторов. Это учебная модель, не паспортные данные.

## Сверка расположения и пути воздуха (11.10.2026, через Exa)

- IBM, «General guidelines for data centers»
  (https://www.ibm.com/docs/en/cloudpakw3700/2.3.3?topic=determination-general-guidelines-data-centers):
  холодный коридор — перфорированные плиты между рядами стоек; входы стоек обращены к холодному коридору;
  горячий воздух из задних панелей возвращается к кондиционерам; «CRAC units are placed at the end of the hot aisles».
- Vertiv, «Focused Cooling Using Cold Aisle Containment»
  (https://www.vertiv.com/4963d0/globalassets/shared/focused-cooling-using-cold-aisle-contaiment.pdf):
  «The CRACs should be located at the end of the hot aisles … Alternatively, use the overhead plenum for hot air
  return to the CRACs». На сцене — колпак горячего коридора и верхний канал к входу кондиционера.
- Liebert HPM Extended, PD 273541, 19.04.2010
  (https://planetaklimata.com.ua/instr/Liebert_Hiross/Liebert_HPM_Extended_Technical_manual_Eng.pdf):
  исполнение DOWN — модуль вентиляторов в фальшполу, UP — над фальшполом; модуль с фильтром и теплообменником отдельно.
  Это другая серия (CW), используется как подтверждение компоновки «вентилятор внизу, подача в подполье».
- Liebert DS, схема GLYCOOL (https://www.manualsdir.com/manuals/169140/liebert-precision-cooling-system-ds.html?page=96):
  расширительный бак «field-installed at highest point in system on return line to pumps», воздухоотводчики
  «at tops of all risers and any intermediate system high points», запорные клапаны, точки давления; в холодильном
  контуре — фильтр-осушитель, смотровое стекло, ТРВ, соленоидный клапан.
- Ecosaire EN Series, раздел «Glycol» (https://www.manualslib.com/manual/2821465/Ecosaire-En-Series.html?page=35):
  сетчатый фильтр 16–20 mesh на входе жидкости у блока с пластинчатым конденсатором; бак «upstream of the pump»;
  воздухоотводчик после насоса, в идеале в высокой точке; манометры, термометры, клапаны по схемам.
- EVAPCO EAW-FD Flat Dry Cooler (https://www.evapco.com/products/closed-circuit-coolers-air-cooled/eaw-fd-flat-dry-cooler):
  «Ambient air is drawn in over the coil surface by the fan located at the top of the unit»; регулирование скорости
  вентиляторов по нагрузке и наружным условиям.

Что исправлено на сцене по итогам сверки: возврат горячего воздуха через колпак и верхний канал (раньше воздух шёл
открыто по залу); ресивер, фильтр-осушитель и смотровое стекло на жидкостной линии; запорные краны, сетчатый фильтр,
манометры, воздухоотводчик и расширительный бак с предохранительным клапаном в контуре смеси.

Допущения без источника: нагрев воздуха в драйкулере (условный расход 10 кВт/К), цвета меди и латуни,
мигание светодиодов. Места арматуры обобщены: на реальной установке их задаёт проект.
