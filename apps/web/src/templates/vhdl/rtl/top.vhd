-- Variante VHDL-2008: contador con enable, GPIO registrado y PWM de 8 bits.
-- Sin CPU. Todo usa un unico reloj y reset activo bajo.
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity top is
  generic (BLINK_BITS : positive := 22);
  port (
    clk, rst_n, enable, write_en : in std_logic;
    gpio_data : in std_logic_vector(7 downto 0);
    gpio_out, count : out std_logic_vector(7 downto 0);
    led, pwm_led : out std_logic
  );
end entity;

architecture rtl of top is
  signal counter : unsigned(BLINK_BITS-1 downto 0);
  signal phase, level : unsigned(7 downto 0);
begin
  process(clk, rst_n)
  begin
    if rst_n='0' then
      counter <= (others => '0'); phase <= (others => '0'); level <= (others => '0');
    elsif rising_edge(clk) then
      if enable='1' then counter <= counter + 1; phase <= phase + 1; end if;
      if write_en='1' then level <= unsigned(gpio_data); end if;
    end if;
  end process;
  count <= std_logic_vector(resize(counter, 8));
  gpio_out <= std_logic_vector(level);
  led <= counter(BLINK_BITS-1);
  pwm_led <= '1' when rst_n='1' and phase < level else '0';
end architecture;
